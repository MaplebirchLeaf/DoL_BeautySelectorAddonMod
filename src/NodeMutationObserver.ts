import type {LogWrapper} from "../../../dist-BeforeSC2/ModLoadController";
import type {ModUtils} from "../../../dist-BeforeSC2/Utils";

export class NodeMutationObserver {
    protected logger: LogWrapper;
    protected observer: MutationObserver;
    protected originalCreateElement: typeof document.createElement;
    protected originalImage: typeof window.Image;

    protected processingElements = new WeakMap<HTMLElement, Set<string>>();
    protected processingUrls = new WeakMap<HTMLElement, Map<string, string>>();
    protected pendingSetters = new WeakMap<HTMLElement, Map<string, Promise<void>>>();
    protected injectedElements = new WeakSet<HTMLElement>();

    protected isStarted = false;

    protected TARGET_TAGS = new Map<string, string[]>([
        ['img', ['src']],
        ['image', ['src', 'href', 'xlink:href']],
        ['video', ['src', 'poster']],
        ['audio', ['src']],
        ['source', ['src']],
    ]);

    protected AttributeFilter = ['src', 'href', 'xlink:href', 'poster'];

    constructor(
        public replaceUrlAsync: (url: string) => Promise<string | undefined>,
        public gModUtils: ModUtils,
        public checkUrlExist?: (url: string) => boolean | undefined,
    ) {
        this.logger = this.gModUtils.getLogger();
        this.observer = new MutationObserver(this.observerCallback);
        this.originalCreateElement = document.createElement.bind(document);
        this.originalImage = window.Image;
    }

    public start() {
        if (this.isStarted) return;
        this.isStarted = true;

        console.log('[NodeMutationObserver] Starting......');
        this.logger.log('[NodeMutationObserver] Starting......');

        this.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: this.AttributeFilter,
        });

        this.hookCreateElement();
        this.hookImageConstructor();
        this.replaceAllOnce();

        console.log('[NodeMutationObserver] Started ok.');
        this.logger.log('[NodeMutationObserver] Started ok.');
    }

    public stop() {
        if (!this.isStarted) return;
        this.isStarted = false;

        this.observer.disconnect();
        document.createElement = this.originalCreateElement;
        window.Image = this.originalImage;

        console.log('[NodeMutationObserver] Stopped.');
        this.logger.log('[NodeMutationObserver] Stopped.');
    }

    public async processNode(node: HTMLElement, noLog?: boolean) {
        const tagName = node.tagName?.toLowerCase();
        const attrs = tagName ? this.TARGET_TAGS.get(tagName) : undefined;
        if (!attrs) return;

        await Promise.allSettled(attrs.map(attr => this.processNodeTag(node, attr, noLog)));
    }

    public async processNodeTag(node: HTMLElement, attrName: string, noLog?: boolean) {
        const tagName = node.tagName?.toLowerCase();
        const lowerName = attrName.toLowerCase();
        const attrs = tagName ? this.TARGET_TAGS.get(tagName) : undefined;
        if (!attrs?.includes(lowerName)) return;

        let lockSet = this.processingElements.get(node);
        if (!lockSet) this.processingElements.set(node, lockSet = new Set());
        if (lockSet.has(lowerName)) return;
        lockSet.add(lowerName);

        try {
            const value = node.getAttribute(attrName);
            const pass = !value
                || !String(value).trim()
                || String(value).trim().toLowerCase() === 'null'
                || String(value).trim().toLowerCase().startsWith('data:')
                || String(value).trim().toLowerCase().startsWith('blob:')
                || String(value).trim().toLowerCase().startsWith('#')
                || String(value).trim().toLowerCase().startsWith('about:')
                || String(value).trim().toLowerCase().startsWith('javascript:');

            if (pass) return;

            const originalUrl = value!;
            const flagAttr = `ml-${lowerName}`;
            const replacedAttr = `ml-replaced-${lowerName}`;
            const prevOriginal = node.getAttribute(flagAttr);
            const prevReplaced = node.getAttribute(replacedAttr);

            if (originalUrl === prevReplaced) return;

            // 重复设置旧原始路径时，直接恢复成已替换路径
            if (originalUrl === prevOriginal && prevReplaced) {
                if (originalUrl !== prevReplaced) node.setAttribute(attrName, prevReplaced);
                return;
            }

            // 明确不是 BSA 图片时，直接放行，避免无意义异步查询
            if (this.checkUrlExist?.(originalUrl) === false) return;

            if (node.hasAttribute(attrName)) node.removeAttribute(attrName);

            try {
                const newUrl = await this.replaceUrlAsync(originalUrl);
                const finalUrl = newUrl && newUrl !== originalUrl ? newUrl : originalUrl;

                node.setAttribute(flagAttr, originalUrl);
                node.setAttribute(replacedAttr, finalUrl);
                node.setAttribute(attrName, finalUrl);
            } catch (err) {
                console.error('[NodeMutationObserver] Replace failed, restoring:', [originalUrl, node, err]);
                !noLog && this.logger.error(`[NodeMutationObserver] Replace failed, restoring. [${originalUrl}]`);

                node.setAttribute(flagAttr, originalUrl);
                node.setAttribute(replacedAttr, originalUrl);
                node.setAttribute(attrName, originalUrl);
            }
        } finally {
            const set = this.processingElements.get(node);
            set?.delete(lowerName);
            if (set && set.size === 0) this.processingElements.delete(node);
        }
    }

    public replaceAllOnce() {
        document.querySelectorAll([...this.TARGET_TAGS.keys()].join(',')).forEach(node => {
            this.processNode(node as HTMLElement);
        });
    }

    protected observerCallback: MutationCallback = (mutationsList: MutationRecord[]) => {
        const selector = [...this.TARGET_TAGS.keys()].join(',');

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;

                    const el = node as HTMLElement;
                    this.processNode(el);

                    el.querySelectorAll?.(selector).forEach(child => {
                        this.processNode(child as HTMLElement);
                    });
                });
                continue;
            }

            if (mutation.type === 'attributes') {
                if (!mutation.attributeName || mutation.target.nodeType !== Node.ELEMENT_NODE) continue;

                const el = mutation.target as HTMLElement;
                const tagName = el.tagName?.toLowerCase();
                const attrName = mutation.attributeName.toLowerCase();
                const attrs = tagName ? this.TARGET_TAGS.get(tagName) : undefined;

                if (attrs?.includes(attrName)) {
                    this.processNodeTag(el, attrName);
                }
            }
        }
    };

    protected injectInterceptors(element: HTMLElement, tagName: string) {
        const lowerTagName = tagName?.toLowerCase();
        const targetAttrs = this.TARGET_TAGS.get(lowerTagName);

        if (!targetAttrs || this.injectedElements.has(element)) return;
        this.injectedElements.add(element);

        const originalSetAttribute = element.setAttribute.bind(element);
        const originalGetAttribute = element.getAttribute.bind(element);
        const owner = this;

        element.setAttribute = (name: string, value: string) => {
            const lowerName = name?.toLowerCase();
            const stringValue = String(value);

            if (!targetAttrs.includes(lowerName) || lowerName.startsWith('ml-')) {
                return originalSetAttribute(name, stringValue);
            }

            const trimmed = stringValue.trim();
            const lowerValue = trimmed.toLowerCase();

            const pass = !trimmed
                || lowerValue === 'null'
                || lowerValue.startsWith('data:')
                || lowerValue.startsWith('blob:')
                || lowerValue.startsWith('#')
                || lowerValue.startsWith('about:')
                || lowerValue.startsWith('javascript:');

            if (pass) {
                const set = this.processingElements.get(element);
                if (set?.has(lowerName)) {
                    let urlMap = this.processingUrls.get(element);
                    if (!urlMap) this.processingUrls.set(element, urlMap = new Map());
                    urlMap.set(lowerName, stringValue);
                }
                return originalSetAttribute(name, stringValue);
            }

            const flagAttr = `ml-${lowerName}`;
            const replacedAttr = `ml-replaced-${lowerName}`;
            const prevOriginal = originalGetAttribute(flagAttr);
            const prevReplaced = originalGetAttribute(replacedAttr);

            if (stringValue === prevReplaced) {
                return originalSetAttribute(name, stringValue);
            }

            // 外部再次设置原始路径时，不回退原始路径，直接使用替换后的路径
            if (stringValue === prevOriginal && prevReplaced) {
                return originalSetAttribute(name, prevReplaced);
            }

            if (this.checkUrlExist?.(stringValue) === false) {
                const set = this.processingElements.get(element);
                if (set?.has(lowerName)) {
                    let urlMap = this.processingUrls.get(element);
                    if (!urlMap) this.processingUrls.set(element, urlMap = new Map());
                    urlMap.set(lowerName, stringValue);
                }
                return originalSetAttribute(name, stringValue);
            }

            let urlMap = this.processingUrls.get(element);
            if (!urlMap) this.processingUrls.set(element, urlMap = new Map());
            urlMap.set(lowerName, stringValue);

            let lockSet = this.processingElements.get(element);
            if (!lockSet) this.processingElements.set(element, lockSet = new Set());

            // 已有同属性替换任务时，只记录最新 URL，等当前任务结束后再处理
            if (lockSet.has(lowerName)) return;
            lockSet.add(lowerName);

            const urlToProcess = stringValue;
            let task!: Promise<void>;

            task = this.replaceUrlAsync(urlToProcess)
                .then((newUrl) => {
                    const currentUrl = this.processingUrls.get(element)?.get(lowerName);
                    if (currentUrl !== urlToProcess) return;

                    const finalUrl = newUrl && newUrl !== urlToProcess ? newUrl : urlToProcess;

                    originalSetAttribute(flagAttr, urlToProcess);
                    originalSetAttribute(replacedAttr, finalUrl);
                    originalSetAttribute(name, finalUrl);
                })
                .catch((err) => {
                    console.error('[NodeMutationObserver] injectInterceptors failed:', [urlToProcess, element, err]);
                    this.logger.error(`[NodeMutationObserver] injectInterceptors failed: [${urlToProcess}]`);

                    const currentUrl = this.processingUrls.get(element)?.get(lowerName);
                    if (currentUrl !== urlToProcess) return;

                    originalSetAttribute(flagAttr, urlToProcess);
                    originalSetAttribute(replacedAttr, urlToProcess);
                    originalSetAttribute(name, urlToProcess);
                })
                .finally(() => {
                    const set = this.processingElements.get(element);
                    set?.delete(lowerName);
                    if (set && set.size === 0) this.processingElements.delete(element);

                    const pendingMap = this.pendingSetters.get(element);
                    if (pendingMap?.get(lowerName) === task) {
                        pendingMap.delete(lowerName);
                        if (pendingMap.size === 0) this.pendingSetters.delete(element);
                    }

                    const currentUrl = this.processingUrls.get(element)?.get(lowerName);
                    const urlMapNow = this.processingUrls.get(element);

                    if (currentUrl === urlToProcess) {
                        urlMapNow?.delete(lowerName);
                        if (urlMapNow && urlMapNow.size === 0) this.processingUrls.delete(element);
                    } else if (currentUrl) {
                        urlMapNow?.delete(lowerName);
                        if (urlMapNow && urlMapNow.size === 0) this.processingUrls.delete(element);
                        element.setAttribute(name, currentUrl);
                    }
                });

            let pendingMap = this.pendingSetters.get(element);
            if (!pendingMap) this.pendingSetters.set(element, pendingMap = new Map());
            pendingMap.set(lowerName, task);

            return;
        };

        for (const attr of targetAttrs) {
            // xlink:href 不是 JS 属性名，只处理 src / href / poster 这类可定义属性
            if (!/^[A-Za-z_$][\w$]*$/.test(attr)) continue;

            let descriptor: PropertyDescriptor | undefined;
            let proto: any = element;

            while (proto && !descriptor) {
                descriptor = Object.getOwnPropertyDescriptor(proto, attr);
                proto = Object.getPrototypeOf(proto);
            }

            if (!descriptor || descriptor.configurable === false) continue;

            const originalGetter = descriptor.get;

            Object.defineProperty(element, attr, {
                configurable: true,
                enumerable: descriptor.enumerable ?? true,
                get: function(this: HTMLElement) {
                    const pending = owner.processingUrls.get(this)?.get(attr);
                    if (pending) return pending;

                    if (originalGetter) return originalGetter.call(this);
                    return originalGetAttribute(attr) ?? '';
                },
                set: function(this: HTMLElement, value: string) {
                    this.setAttribute(attr, String(value));
                },
            });
        }

        if (lowerTagName === 'img') {
            const img = element as HTMLImageElement;
            const anyImg = img as any;

            if (!anyImg.__ml_decode_hooked) {
                const nativeDecode = img.decode?.bind(img);

                if (nativeDecode) {
                    anyImg.__ml_decode_hooked = true;

                    // 等 BSA 异步替换 src 完成后，再调用原生 decode
                    img.decode = async () => {
                        let lastTask: Promise<void> | undefined;

                        for (let i = 0; i < 8; i++) {
                            const task = this.pendingSetters.get(img as any as HTMLElement)?.get('src');
                            if (!task || task === lastTask) break;

                            lastTask = task;
                            await task.catch(() => {});
                        }

                        return nativeDecode();
                    };
                }
            }
        }
    }

    protected hookCreateElement() {
        document.createElement = ((tagName: any, options?: ElementCreationOptions) => {
            const element = (this.originalCreateElement as any)(tagName, options);
            this.injectInterceptors(element as HTMLElement, String(tagName));
            return element;
        }) as typeof document.createElement;
    }

    protected hookImageConstructor() {
        const thisPtr = this;
        const OriginalImage = this.originalImage;

        window.Image = class extends OriginalImage {
            constructor(width?: number, height?: number) {
                super(width, height);
                thisPtr.injectInterceptors(this as any as HTMLElement, 'img');
            }
        } as any;
    }
}