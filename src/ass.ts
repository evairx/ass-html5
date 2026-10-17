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
   * Optional container element or query selector to host the subtitle overlay.
   * If omitted, the overlay is inserted immediately after the video element.
   */
  container?: HTMLElement | string;

  /**
   * Protected height in CSS pixels for native HTML5 video controls, or boolean to toggle.
   * When enabled (e.g. `controlsPadding: true` or `controlsPadding: 48`), a CSS `clip-path`
   * is applied to the subtitle overlay so subtitles do not overlap the native HTML5 player controls bar.
   * If true, defaults to 56px in fullscreen and 48px in inline playback.
   * If a number is specified, that exact height is reserved.
   * Disabled by default (false) so bottom subtitles (MarginV) remain fully visible.
   */
  controlsPadding?: number | boolean;

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
  private container?: HTMLElement | string;
  private containerElement: HTMLElement | null = null;
  private controlsPadding?: number | boolean;
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
    this.container = options.container;
    this.controlsPadding = options.controlsPadding;
    this.fonts = options.fonts;
    this.zIndex = options.zIndex;
    this.onReady = options.onReady;
    if (options.logging) this.logging = options.logging;
  }

  /**
   * Set or toggle the protected height in CSS pixels for native HTML5 video controls.
   */
  setControlsPadding(padding: number | boolean) {
    this.controlsPadding = padding;
    this.setCanvasSize();
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

    if (typeof this.container === 'string') {
      this.containerElement = document.querySelector(this.container);
    } else if (this.container) {
      this.containerElement = this.container;
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
      this.fontRatios,
      this.containerElement
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

    // Fullscreen detection: video element fullscreen vs container host fullscreen
    const hostIsFullscreen = !!(
      document.fullscreenElement &&
      document.fullscreenElement !== this.videoElement &&
      this.videoElement &&
      document.fullscreenElement.contains(this.videoElement)
    );
    const videoIsFullscreen = document.fullscreenElement === this.videoElement;
    const isFullscreen = videoIsFullscreen || hostIsFullscreen;

    let width = maxWidth;
    let height = maxHeight;
    let x = videoIsFullscreen ? 0 : offsetLeft;
    let y = videoIsFullscreen ? 0 : offsetTop;

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
      this.placeOverlay(this.renderer.renderDiv, videoIsFullscreen);
      this.renderer.renderDiv.style.width = width + 'px';
      this.renderer.renderDiv.style.height = height + 'px';
      this.renderer.renderDiv.style.top = y + 'px';
      this.renderer.renderDiv.style.left = x + 'px';

      // Controls protection (SOLUCION.md section 11):
      // Only apply clip-path if explicitly requested via controlsPadding.
      // Disabled by default (false/undefined) so bottom subtitles (MarginV) remain fully visible.
      let controlsBarHeight = 0;
      if (typeof this.controlsPadding === 'number') {
        controlsBarHeight = this.controlsPadding;
      } else if (this.controlsPadding === true) {
        controlsBarHeight = isFullscreen ? 56 : 48;
      }

      if (controlsBarHeight > 0) {
        const imgBottom = (maxHeight + height) / 2;
        const overlap = Math.max(0, imgBottom - (maxHeight - controlsBarHeight));
        if (overlap > 0) {
          this.renderer.renderDiv.style.clipPath = `inset(0px 0px ${Math.round(overlap)}px 0px)`;
        } else {
          this.renderer.renderDiv.style.clipPath = '';
        }
      } else {
        this.renderer.renderDiv.style.clipPath = '';
      }
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
   * While the video element is fullscreen, the browser paints only the video and its native
   * controls in the Top Layer, so the overlay moves to the top layer via Popover API.
   * When the host container is fullscreen or during inline playback, the overlay stays
   * in the DOM flow with position: absolute without popover.
   */
  private placeOverlay(overlay: HTMLDivElement, videoFullscreen: boolean) {
    if (!('showPopover' in overlay)) return;

    if (videoFullscreen) {
      if (!overlay.hasAttribute('popover')) {
        overlay.setAttribute('popover', 'manual');
        try {
          overlay.showPopover();
        } catch {}
      }
      overlay.style.position = 'fixed';
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
      overlay.style.border = 'none';
      overlay.style.background = 'none';
    } else {
      if (overlay.hasAttribute('popover')) {
        try {
          overlay.hidePopover();
        } catch {}
        overlay.removeAttribute('popover');
      }
      overlay.style.position = 'absolute';
      overlay.style.right = '';
      overlay.style.bottom = '';
      overlay.style.border = '';
      overlay.style.background = '';
    }
  }

  private async loadFonts(fonts: Font[]) {
    await Promise.all(
      fonts.map(async (font) => {
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
      })
    );
    try {
      await (document as any).fonts?.ready;
    } catch {}
  }

  private async registerFontFace(
    family: string,
    buffer: ArrayBuffer,
    descriptors?: Partial<FontStyle>
  ) {
    const cleanFamily = family.trim().replace(/^["']|["']$/g, '');
    const weights: string[] = [];
    if (descriptors?.weight) {
      weights.push(String(descriptors.weight));
    }
    // Register both 'normal' (400) and 'bold' (700) so Canvas 2D font queries
    // with either normal or bold weight match this face directly instead of falling back to Arial.
    if (!weights.includes('normal')) weights.push('normal');
    if (!weights.includes('bold')) weights.push('bold');

    let anyLoaded = false;
    for (const weight of weights) {
      try {
        const face = new FontFace(cleanFamily, buffer.slice(0), {
          style: descriptors?.style || 'normal',
          weight
        } as FontFaceDescriptors);
        const loaded = await face.load();
        // @ts-ignore
        document.fonts.add(loaded);
        if (loaded.status === 'loaded') anyLoaded = true;
      } catch {
        try {
          const fallbackFace = new FontFace(cleanFamily, buffer.slice(0));
          const loaded = await fallbackFace.load();
          // @ts-ignore
          document.fonts.add(loaded);
          if (loaded.status === 'loaded') anyLoaded = true;
        } catch {}
      }
    }

    return anyLoaded;
  }

  private async loadFont(font: Font) {
    const response = await fetch(font.url);
    const buffer = await response.arrayBuffer();

    const metrics = parseFontMetrics(buffer);
    const rawFamily = font.family.trim().replace(/^["']|["']$/g, '');
    this.fontRatios.set(rawFamily.toLowerCase(), metrics.ratio);

    const cleanFamily = rawFamily
      .replace(/\s+(semibold|bold|regular|light|medium|black|italic)/i, '')
      .trim();
    if (cleanFamily) {
      this.fontRatios.set(cleanFamily.toLowerCase(), metrics.ratio);
    }

    const loaded = await this.registerFontFace(rawFamily, buffer, font.descriptors);

    // If any style or tag in the ASS script references a variant containing font.family
    // (e.g. font.family = "Source Sans Pro" and ASS style fn = "Source Sans Pro Semibold"),
    // register an alias FontFace so canvas matches it directly without falling back to serif.
    if (this.compiledAss) {
      const needed = new Set<string>();
      Object.values(this.compiledAss.styles).forEach((s) => {
        if (s.tag.fn) needed.add(s.tag.fn);
        if (s.style?.Fontname) needed.add(s.style.Fontname);
      });
      this.compiledAss.dialogues.forEach((d) => {
        d.slices?.forEach((sl) => {
          sl.fragments?.forEach((f) => {
            if (f.tag?.fn) needed.add(f.tag.fn);
          });
        });
      });

      const familyLower = rawFamily.toLowerCase();
      for (const name of needed) {
        const cleanName = name.trim().replace(/^["']|["']$/g, '');
        const nameLower = cleanName.toLowerCase();
        if (
          nameLower !== familyLower &&
          (nameLower.includes(familyLower) || familyLower.includes(nameLower))
        ) {
          this.fontRatios.set(cleanName.toLowerCase(), metrics.ratio);
          try {
            await this.registerFontFace(cleanName, buffer, font.descriptors);
          } catch {}
        }
      }
    }

    if (this.renderer) {
      this.renderer.setFontRatios(this.fontRatios);
      this.renderer.invalidate();
      this.renderer.forceRender(this.videoElement?.currentTime ?? 0);
    }

    return loaded;
  }
}

export default ASS;
