import { compile, type CompiledASS } from 'ass-compiler';
import { Renderer } from './renderer';
import type { OnInitSizes } from './types';
import { parseFontMetrics } from './utils';

export type ASSOptions = {
  /**
   * The ass text string.
   * Can be omitted if `subUrl` is provided.
   */
  assText?: string;

  /**
   * URL to fetch the ASS content from.
   */
  subUrl?: string;

  /**
   * The video to display the subtile on.
   * Can be either an `HTMLVideoElement` or `string` (html query selector)
   */
  video: HTMLVideoElement | string;

  /**
   * List of fonts to load. This ensures that all the fonts
   * needed for the rendering are present and loaded into the document
   */
  fonts?: Font[];

  /**
   * Corresponds to the `z-index` to placed the Canvas renderer
   * > The renderer will always be added right after the `video` element
   */
  zIndex?: number;

  /**
   * A Callback that is invoked when the preprocess of the ass text by render is done
   */
  onReady?: () => void;

  /**
   * Type of logging
   * - `DEBUG` only debug type log will be displayed
   * - `DISABLE` no logging will be emitted (default)
   * - `VERBOSE` every log will be shown
   * - `WARN` only warning will be shown
   */
  logging?: LOGTYPE;
};

export type LOGTYPE = 'DISABLE' | 'VERBOSE' | 'DEBUG' | 'WARN';

export type FontStyle = {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/ascentOverride) */
  ascentOverride: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/descentOverride) */
  descentOverride: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/display) */
  display: FontDisplay;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/family) */
  family: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/featureSettings) */
  featureSettings: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/lineGapOverride) */
  lineGapOverride: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/stretch) */
  stretch: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/style) */
  style: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/unicodeRange) */
  unicodeRange: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/variant) */
  variant: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/weight) */
  weight: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/load) */
};

export type Font = {
  family: string;
  url: string;
  descriptors?: Partial<FontStyle>;
};

/**
 * @class ASS
 *
 * ASS is an ass/ssa subtitle renderer for HTML5 video.
 *
 * It creates a wrapper around the video element and overlays a canvas
 * to draw the subtitles with high performance.
 *
 * Usage:
 * ```javascript
 * const ass = new ASS({
 *   subUrl: '/path/to/subs.ass',
 *   video: document.querySelector('video')
 * });
 * await ass.render();
 * ```
 * */
export class ASS {
  assText: string = '';
  subUrl?: string;
  private video: HTMLVideoElement | string;
  videoElement: HTMLVideoElement | null = null;
  private renderer: Renderer | null = null;
  private ro: ResizeObserver | null = null;
  private fonts?: Font[];
  private zIndex?: number;
  private onReady?: () => void;
  private logging: LOGTYPE = 'DISABLE';
  private compiledAss: CompiledASS | null = null;
  private fontRatios: Map<string, number> = new Map();
  private readonly onFullscreenChange = () => this.setCanvasSize();
  private readonly onLoadedMetadata = () => this.setCanvasSize();

  constructor(options: ASSOptions) {
    if (options.assText) {
      this.assText = options.assText;
      this.compiledAss = compile(this.assText, {});
    }
    this.subUrl = options.subUrl;
    this.video = options.video;
    this.fonts = options.fonts;
    this.zIndex = options.zIndex;
    this.onReady = options.onReady;
    if (options.logging) this.logging = options.logging;
  }

  /**
   * Start the ass rendering process
   */
  async render() {
    if (typeof this.video == 'string') {
      this.videoElement = document.querySelector(this.video);
      if (this.videoElement === null) {
        throw new Error('Unable to find the video element');
      }
    } else {
      this.videoElement = this.video;
    }

    if (this.subUrl && !this.assText) {
      await this.fetchAss(this.subUrl);
    } else if (!this.compiledAss && this.assText) {
      this.compiledAss = compile(this.assText, {});
    }

    if (!this.compiledAss) {
      if (this.logging !== 'DISABLE') console.warn('ASS: No text to render');
      return;
    }

    const sizes = this.setCanvasSize();

    if (typeof this.fonts !== 'undefined') {
      await this.loadFonts(this.fonts);
    }

    if (this.videoElement) {
      this.initRenderer(sizes);

      this.videoElement.addEventListener('loadedmetadata', this.onLoadedMetadata);
      document.addEventListener('fullscreenchange', this.onFullscreenChange);

      this.ro = new ResizeObserver(this.setCanvasSize.bind(this));
      this.ro.observe(this.videoElement);
    }
  }

  private async fetchAss(url: string) {
    const response = await fetch(url);
    this.assText = await response.text();
    this.compiledAss = compile(this.assText, {});
  }

  private async initRenderer(sizes?: OnInitSizes) {
    if (!this.videoElement || !this.compiledAss) return;

    if (!sizes) sizes = this.setCanvasSize();

    this.renderer = new Renderer(
      this.compiledAss,
      sizes,
      this.videoElement,
      this.logging,
      this.zIndex,
      this.fontRatios
    );

    // Ensure canvas size is set correctly on init
    this.setCanvasSize();
    if (this.videoElement.readyState >= 1) {
      this.setCanvasSize();
    }

    await this.renderer.warmup();
    if (this.onReady) {
      this.onReady();
    }

    await this.renderer.startRendering();
  }

  /**
   * Switch the ASS text content dynamically.
   * @param text The new ASS text content
   */
  async setAssText(text: string) {
    this.assText = text;
    this.compiledAss = compile(this.assText, {});

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
      if (this.videoElement) {
        await this.initRenderer();
      }
    }
  }

  /**
   * Switch the ASS text content from a URL.
   * @param url The URL to fetch the ASS content from
   */
  async setSubUrl(url: string) {
    this.subUrl = url;
    await this.fetchAss(url);

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
      if (this.videoElement) {
        await this.initRenderer();
      }
    }
  }

  /**
   * Stop the rendering
   */
  destroy() {
    this.videoElement?.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.ro?.disconnect();

    this.renderer?.destroy();
    this.renderer = null;
  }

  private setCanvasSize() {
    const { videoWidth, videoHeight, offsetTop, offsetLeft } = this
      .videoElement as HTMLVideoElement;

    const maxWidth = this.videoElement?.clientWidth || 0;
    const maxHeight = this.videoElement?.clientHeight || 0;

    if (maxWidth <= 0 || maxHeight <= 0) {
      return { width: 0, height: 0, x: 0, y: 0 } as OnInitSizes;
    }

    const videoRatio = videoWidth && videoHeight ? videoWidth / videoHeight : 0;
    const scriptRatio =
      this.compiledAss?.width && this.compiledAss?.height
        ? this.compiledAss.width / this.compiledAss.height
        : 0;
    const aspectRatio =
      videoRatio || scriptRatio || (maxWidth && maxHeight ? maxWidth / maxHeight : 16 / 9);

    const isFullscreen = !!document.fullscreenElement;

    let width = maxWidth;
    let height = maxHeight;
    let x = isFullscreen ? 0 : offsetLeft;
    let y = isFullscreen ? 0 : offsetTop;

    if (maxHeight * aspectRatio > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
      y += (maxHeight - height) / 2;
    } else {
      height = maxHeight;
      width = height * aspectRatio;
      x += (maxWidth - width) / 2;
    }

    width = Math.round(width);
    height = Math.round(height);
    x = Math.round(x);
    y = Math.round(y);

    const sizes = {
      width,
      height,
      x,
      y
    } as OnInitSizes;

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    if (this.renderer?.renderDiv) {
      this.placeOverlay(this.renderer.renderDiv, isFullscreen);
      this.renderer.renderDiv.style.width = width + 'px';
      this.renderer.renderDiv.style.height = height + 'px';
      this.renderer.renderDiv.style.top = y + 'px';
      this.renderer.renderDiv.style.left = x + 'px';
    }

    const targetCanvasWidth = Math.round(width * dpr);
    const targetCanvasHeight = Math.round(height * dpr);

    let changed = false;
    this.renderer?.layers.forEach((layer) => {
      if (layer.canvas.width !== targetCanvasWidth || layer.canvas.height !== targetCanvasHeight) {
        layer.canvas.width = targetCanvasWidth;
        layer.canvas.height = targetCanvasHeight;
        changed = true;
      }
      layer.canvas.style.width = width + 'px';
      layer.canvas.style.height = height + 'px';
      // @ts-ignore
      layer.ctx.textRendering = 'geometricPrecision';
    });
    if (changed) {
      this.renderer?.invalidate();
      this.renderer?.forceRender(this.videoElement?.currentTime ?? 0);
    }

    return sizes;
  }

  /**
   * While the video is fullscreen, the browser paints only the video and its controls, so the
   * overlay moves to the top layer (Popover API). It has pointer-events: none, so the controls
   * still receive clicks.
   */
  private placeOverlay(overlay: HTMLDivElement, fullscreen: boolean) {
    if (!('showPopover' in overlay)) return;

    if (fullscreen && !overlay.hasAttribute('popover')) {
      overlay.setAttribute('popover', 'manual');
      try {
        overlay.showPopover();
      } catch {}
    } else if (!fullscreen && overlay.hasAttribute('popover')) {
      try {
        overlay.hidePopover();
      } catch {}
      overlay.removeAttribute('popover');
    }

    overlay.style.position = fullscreen ? 'fixed' : 'absolute';
    overlay.style.right = fullscreen ? 'auto' : '';
    overlay.style.bottom = fullscreen ? 'auto' : '';
    overlay.style.border = fullscreen ? 'none' : '';
    overlay.style.background = fullscreen ? 'none' : '';
  }

  private async loadFonts(fonts: Font[]) {
    for (const font of fonts) {
      try {
        const loaded = await this.loadFont(font);
        if (loaded) {
          if (this.logging == 'VERBOSE')
            console.info(`Font ${font.family} loaded from ${font.url}`);
        } else {
          if (this.logging == 'VERBOSE' || this.logging == 'WARN')
            console.warn(`Unable to load font ${font.family} from ${font.url}`);
        }
      } catch (e) {
        if (this.logging == 'VERBOSE' || this.logging == 'WARN') {
          console.warn(`Unable to load font ${font.family} from ${font.url}`);
          console.warn(e);
        }
      }
    }
  }

  private async loadFont(font: Font) {
    const response = await fetch(font.url);
    const buffer = await response.arrayBuffer();

    const metrics = parseFontMetrics(buffer);
    const rawFamily = font.family.trim().replace(/^["']|["']$/g, '');
    this.fontRatios.set(rawFamily.toLowerCase(), metrics.ratio);

    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    const fontFace = new FontFace(
      rawFamily,
      `url(${url})`,
      (font.descriptors || {}) as FontFaceDescriptors
    );
    const loadedFace = await fontFace.load();
    // @ts-ignore
    document.fonts.add(loadedFace);

    if (this.renderer) {
      this.renderer.setFontRatios(this.fontRatios);
      this.renderer.invalidate();
      this.renderer.forceRender(this.videoElement?.currentTime ?? 0);
    }

    return fontFace.status === 'loaded';
  }
}

export default ASS;
