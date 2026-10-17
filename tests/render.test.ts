import { describe, it, expect, beforeEach, vi } from 'vitest';
import ASS from '../src/ass';
import { interpolateColor, blendAlpha, parseAlpha, parseFontMetrics } from '../src/utils';

describe('Render Quality and LibASS Styling', () => {
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    videoElement = document.createElement('video');
    Object.defineProperty(videoElement, 'videoWidth', {
      value: 1280,
      configurable: true,
      writable: true
    });
    Object.defineProperty(videoElement, 'videoHeight', {
      value: 720,
      configurable: true,
      writable: true
    });
    Object.defineProperty(videoElement, 'clientWidth', {
      value: 1280,
      configurable: true,
      writable: true
    });
    Object.defineProperty(videoElement, 'clientHeight', {
      value: 720,
      configurable: true,
      writable: true
    });
    Object.defineProperty(videoElement, 'offsetLeft', {
      value: 0,
      configurable: true,
      writable: true
    });
    Object.defineProperty(videoElement, 'offsetTop', {
      value: 0,
      configurable: true,
      writable: true
    });
    document.body.appendChild(videoElement);

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(cb, 16) as unknown as number;
    });
  });

  it('should keep fill text crisp (filter=none, shadow=transparent) when outline is present', async () => {
    const assText = `[Script Info]
Title: Crisp Fill Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\blur2}Crisp Text`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let strokeFilter = '';
    let fillFilter = '';
    let fillShadow = '';

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origStroke = ctx.strokeText;
        const origFill = ctx.fillText;
        ctx.strokeText = function (...args: any[]) {
          strokeFilter = this.filter;
          return origStroke.apply(this, args as any);
        };
        ctx.fillText = function (...args: any[]) {
          fillFilter = this.filter;
          fillShadow = this.shadowColor;
          return origFill.apply(this, args as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;
    renderer.display(1);

    expect(strokeFilter).toContain('blur');
    expect(fillFilter).toBe('none');
    expect(fillShadow).toMatch(/transparent|rgba\(.*,\s*0(\.0+)?\)/);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should use authentic font size and render all layers onto a single canvas in layer order', async () => {
    const assText = `[Script Info]
Title: Sizing and Layer Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,TestFont,100,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 2,0:00:00.00,0:00:05.00,Default,,0,0,0,,Top Layer 2
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Bottom Layer 0`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const fontsUsed: string[] = [];
    const filledTexts: string[] = [];

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (text: any, ...args: any[]) {
          fontsUsed.push(this.font);
          filledTexts.push(String(text));
          return origFill.apply(this, [text, ...args] as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    // Single canvas in DOM
    expect(renderer.layers.length).toBe(1);

    renderer.display(1);

    expect(fontsUsed.length).toBe(2);
    // Authentic ASS font size scaled by standard typographic cell height ratio (0.895)
    expect(fontsUsed[0]).toContain('89.500px');
    expect(fontsUsed[0]).toContain('TestFont');

    // Layer 0 is rendered first, then Layer 2 on top!
    expect(filledTexts[0]).toBe('Bottom Layer 0');
    expect(filledTexts[1]).toBe('Top Layer 2');

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should remove loadedmetadata listener on destroy', async () => {
    const removeEventListenerSpy = vi.spyOn(videoElement, 'removeEventListener');

    const ass = new ASS({
      assText: `[Script Info]
Title: Cleanup Test
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hello`,
      video: videoElement
    });

    await ass.render();
    ass.destroy();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
  });

  it('should interpolate colors accurately', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateColor('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('should blendAlpha correctly with edge cases and missing color', () => {
    expect(blendAlpha('#ffffff', 0)).toBe('rgba(255, 255, 255, 1.000)');
    expect(blendAlpha('#ffffff', 255)).toBe('rgba(255, 255, 255, 0.000)');
    expect(blendAlpha('', 0)).toBe('rgba(0, 0, 0, 1.000)');
  });

  it('should interpolate \\t animation from base value and hold after completion', async () => {
    const assText = `[Script Info]
Title: Animation Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\bord10\\t(0,500,\\bord2)}Animated Text`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let recordedLineWidths: number[] = [];

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origStroke = ctx.strokeText;
        ctx.strokeText = function (...args: any[]) {
          recordedLineWidths.push(this.lineWidth);
          return origStroke.apply(this, args as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    // At t = 0.0s, start of animation: border is base value (10 + 10 = 20 upscale factor 1)
    recordedLineWidths = [];
    renderer.display(0);
    expect(recordedLineWidths.length).toBeGreaterThan(0);
    const startWidth = recordedLineWidths[0]!;
    expect(startWidth).toBeCloseTo(20, 1);

    // At t = 0.5s, end of animation: border reaches target value (2 + 2 = 4)
    recordedLineWidths = [];
    renderer.display(0.5);
    expect(recordedLineWidths.length).toBeGreaterThan(0);
    const endWidth = recordedLineWidths[0]!;
    expect(endWidth).toBeCloseTo(4, 1);

    // At t = 2.0s, AFTER animation: border MUST HOLD target value (4), NOT revert to 0 or base!
    recordedLineWidths = [];
    renderer.display(2.0);
    expect(recordedLineWidths.length).toBeGreaterThan(0);
    const afterWidth = recordedLineWidths[0]!;
    expect(afterWidth).toBeCloseTo(4, 1);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should interpolate \\t color animation', async () => {
    const assText = `[Script Info]
Title: Color Animation Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\1c&H0000FF&\\t(0,500,\\1c&HFF0000&)}Color Anim`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let recordedFillColors: string[] = [];

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (...args: any[]) {
          recordedFillColors.push(this.fillStyle as string);
          return origFill.apply(this, args as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    // At t = 0.0s, initial color is red (ASS BGR 0000FF -> RGB #ff0000)
    recordedFillColors = [];
    renderer.display(0);
    expect(recordedFillColors[0]?.toLowerCase()).toMatch(/#ff0000|rgba\(255,\s*0,\s*0/);

    // At t = 0.5s, target color is blue (ASS BGR FF0000 -> RGB #0000ff)
    recordedFillColors = [];
    renderer.display(0.5);
    expect(recordedFillColors[0]?.toLowerCase()).toMatch(/#0000ff|rgba\(0,\s*0,\s*255/);

    // At t = 2.0s, after animation ends, it stays blue
    recordedFillColors = [];
    renderer.display(2.0);
    expect(recordedFillColors[0]?.toLowerCase()).toMatch(/#0000ff|rgba\(0,\s*0,\s*255/);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should parse alpha values safely and correctly', () => {
    expect(parseAlpha(undefined)).toBe(0);
    expect(parseAlpha('')).toBe(0);
    expect(parseAlpha('00')).toBe(0);
    expect(parseAlpha('FF')).toBe(255);
    expect(parseAlpha('&HAA&')).toBe(170);
    expect(parseAlpha(128)).toBe(128);
  });

  it('should recognize ASS Bold: -1 and override tags as bold', async () => {
    const assText = `[Script Info]
Title: Bold Spec Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\b-1}BoldByTag{\\b0}Regular{\\b700}Bold700`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const fontsUsed: string[] = [];

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (...args: any[]) {
          fontsUsed.push(this.font);
          return origFill.apply(this, args as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;
    renderer.display(1.0);

    // The style has Bold: -1, and tags override with \b-1, \b0, \b700
    expect(fontsUsed.some((f) => f.includes('bold'))).toBe(true);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should include fsp font spacing in character advance and line width', async () => {
    const assText = `[Script Info]
Title: Fsp Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: WithSpacing,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,10,0,1,0,0,2,10,10,10,1
Style: NoSpacing,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,WithSpacing,,0,0,0,,ABCD
Dialogue: 0,0:00:00.00,0:00:05.00,NoSpacing,,0,0,0,,ABCD`;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    const withSpacingDialogue = renderer.ppass[0];
    const noSpacingDialogue = renderer.ppass[1];

    const layer = renderer.layers[0];
    const widthWithSpacing = renderer.lineWidth(layer, withSpacingDialogue.chars);
    const widthNoSpacing = renderer.lineWidth(layer, noSpacingDialogue.chars);

    // ABCD has 4 characters = 3 gaps * 10px spacing = 30px wider
    expect(widthWithSpacing).toBeGreaterThan(widthNoSpacing);
    expect(widthWithSpacing - widthNoSpacing).toBeCloseTo(30, 1);

    ass.destroy();
  });

  it('should translate drawing path by -minX and -minY to align bounding box with pos', async () => {
    const assText = `[Script Info]
Title: Drawing Bbox Alignment Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\an7\\pos(100,100)\\p1}m -10 -20 l 10 -20 l 10 20 l -10 20`;

    let capturedMatrix: any = undefined;
    class MockPath2D {
      d?: string;
      constructor(d?: string) {
        this.d = d;
      }
      addPath(path: any, transform?: any) {
        if (transform) {
          capturedMatrix = transform;
        }
      }
    }
    class MockDOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      scale(sx: number, sy: number) {
        this.a *= sx;
        this.d *= sy;
        return this;
      }
      translate(tx: number, ty: number) {
        this.e += this.a * tx;
        this.f += this.d * ty;
        return this;
      }
    }

    const prevPath2D = (global as any).Path2D;
    const prevDOMMatrix = (global as any).DOMMatrix;
    (global as any).Path2D = MockPath2D;
    (global as any).DOMMatrix = MockDOMMatrix;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;
    renderer.display(1.0);

    // minX is -10, minY is -20. Matrix must translate by -minX (+10) and -minY (+20) before scaling
    expect(capturedMatrix).toBeDefined();
    expect(capturedMatrix!.e).toBeCloseTo(10, 1);
    expect(capturedMatrix!.f).toBeCloseTo(20, 1);

    (global as any).Path2D = prevPath2D;
    (global as any).DOMMatrix = prevDOMMatrix;
    ass.destroy();
  });

  it('should synchronously forceRender on canvas resize to eliminate flickering', async () => {
    const assText = `[Script Info]
Title: Resize Flicker Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,Resize Text`;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;
    const forceRenderSpy = vi.spyOn(renderer, 'forceRender');

    // Simulate window/container resize
    Object.defineProperty(videoElement, 'clientWidth', { value: 640 });
    Object.defineProperty(videoElement, 'clientHeight', { value: 360 });

    (ass as any).setCanvasSize();

    // forceRender must be called synchronously to avoid painting blank canvas frames
    expect(forceRenderSpy).toHaveBeenCalled();
    expect(renderer.layers[0]?.canvas.width).toBe(640);
    expect(renderer.layers[0]?.canvas.height).toBe(360);

    ass.destroy();
  });

  it('should dynamically evaluate animated fscx/fscy and frx without error', async () => {
    const assText = `[Script Info]
Title: Pop-in FX Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,fx,{\\fscy0\\fscx0\\an5\\frx-270\\t(0,360,\\frx0)\\t(0,360,\\fscy120\\fscx120)}s`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let filled = 0;

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (...args: any[]) {
          filled++;
          return origFill.apply(this, args as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    // At t = 0.0s, scale is 0 so drawing is safely skipped without singular matrix errors
    filled = 0;
    renderer.display(0);
    expect(filled).toBe(0);

    // At t = 0.36s (360ms), scale is 120% and frx is 0, drawing succeeds
    filled = 0;
    renderer.display(0.36);
    expect(filled).toBe(1);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should center \\pos(640,697)\\an2 text exactly at x = 640 without leftward drift', async () => {
    const assText = `[Script Info]
Title: Exact Center Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: OPTL,Cabin Condensed,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H004B2919,-1,0,0,0,100,100,2,0,1,1.5,0,2,10,10,23,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 39,0:00:00.00,0:00:05.00,OPTL,,0,0,0,fx,{\\an2\\pos(640,697)}Sister's noise, I will continue to search`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let textDrawX = 0;
    let drawnString = '';
    let measuredWidth = 0;

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (text: any, x: number, ...args: any[]) {
          drawnString = String(text);
          textDrawX = x;
          measuredWidth = this.measureText(String(text)).width;
          return origFill.apply(this, [text, x, ...args] as any);
        };
      }
      return ctx;
    } as any;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;
    renderer.display(1.0);

    expect(drawnString).toBe("Sister's noise, I will continue to search");
    const layer = renderer.layers[0];
    const dialogue = renderer.ppass[0];
    const calculatedWidth = renderer.lineWidth(layer, dialogue.chars);
    // In ass-html5, for \pos(baseX, baseY)\an2, the line is centered at baseX (640).
    // textDrawX is baseX - calculatedWidth / 2, so textDrawX + calculatedWidth / 2 must equal 640!
    expect(textDrawX + calculatedWidth / 2).toBeCloseTo(640, 1);

    ass.destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('should register both normal and bold font faces for loaded fonts and handle aliases', async () => {
    const registeredFaces: { family: string; weight?: string; style?: string }[] = [];
    class MockFontFace {
      family: string;
      source: any;
      descriptors: any;
      status = 'loaded';
      constructor(family: string, source: any, descriptors?: any) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
      }
      async load() {
        return this;
      }
    }

    const origFontFace = (global as any).FontFace;
    const origFonts = (global as any).document.fonts;
    (global as any).FontFace = MockFontFace;
    (global as any).document.fonts = {
      add: (face: any) => {
        registeredFaces.push({
          family: face.family,
          weight: face.descriptors?.weight,
          style: face.descriptors?.style
        });
      },
      ready: Promise.resolve()
    };

    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16))
    }) as any;

    const assText = `[Script Info]
Title: Font Alias Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Source Sans Pro Semibold,56,&H00FFFFFF,&H000000FF,&H001D1D37,&HC00E0E2E,-1,0,0,0,97,100,0,0,1,3.4,1.8,2,120,120,42,1
Style: OPTL,Cabin Condensed,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H004B2919,-1,0,0,0,100,100,2,0,1,1.5,0,2,10,10,23,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Default Line`;

    const ass = new ASS({
      assText,
      video: videoElement,
      fonts: [
        { family: 'Source Sans Pro', url: '/SourceSansPro-SemiBold.ttf' },
        { family: 'Cabin Condensed', url: '/CabinCondensed-Regular.ttf' }
      ]
    });

    await ass.render();

    // Verify Cabin Condensed was registered with both normal and bold
    expect(
      registeredFaces.some((f) => f.family === 'Cabin Condensed' && f.weight === 'normal')
    ).toBe(true);
    expect(registeredFaces.some((f) => f.family === 'Cabin Condensed' && f.weight === 'bold')).toBe(
      true
    );

    // Verify alias 'Source Sans Pro Semibold' was registered with both normal and bold
    expect(
      registeredFaces.some((f) => f.family === 'Source Sans Pro Semibold' && f.weight === 'normal')
    ).toBe(true);
    expect(
      registeredFaces.some((f) => f.family === 'Source Sans Pro Semibold' && f.weight === 'bold')
    ).toBe(true);

    ass.destroy();
    (global as any).FontFace = origFontFace;
    (global as any).document.fonts = origFonts;
    global.fetch = globalFetch;
  });

  it('should parse font metrics from TTF tables and compute correct OS/2 ratio', () => {
    // Construct a synthetic OpenType table buffer with 'head' (unitsPerEm=1000) and 'OS/2' (winAscent=1139, winDescent=314)
    const buffer = new ArrayBuffer(200);
    const view = new DataView(buffer);
    // Header
    view.setUint32(0, 0x00010000); // sfnt version
    view.setUint16(4, 2); // numTables = 2
    // Table directory 1: 'head'
    view.setUint8(12, 'h'.charCodeAt(0));
    view.setUint8(13, 'e'.charCodeAt(0));
    view.setUint8(14, 'a'.charCodeAt(0));
    view.setUint8(15, 'd'.charCodeAt(0));
    view.setUint32(20, 50); // offset = 50
    view.setUint32(24, 30); // length = 30
    // 'head' table at offset 50: unitsPerEm at +18 (50+18 = 68)
    view.setUint16(68, 1000);

    // Table directory 2: 'OS/2'
    view.setUint8(28, 'O'.charCodeAt(0));
    view.setUint8(29, 'S'.charCodeAt(0));
    view.setUint8(30, '/'.charCodeAt(0));
    view.setUint8(31, '2'.charCodeAt(0));
    view.setUint32(36, 100); // offset = 100
    view.setUint32(40, 80); // length = 80
    // 'OS/2' table at offset 100: winAscent at +74 (174), winDescent at +76 (176)
    view.setUint16(174, 1139);
    view.setUint16(176, 314);

    const metrics = parseFontMetrics(buffer);
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.winAscent).toBe(1139);
    expect(metrics.winDescent).toBe(314);
    expect(metrics.ratio).toBeCloseTo(1000 / 1453, 5);
  });

  it('should evaluate custom animations exactly once per frame without double interpolation', async () => {
    const assText = `[Script Info]
Title: Single Animation Evaluation Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\fscx100\\t(0,1000,\\fscx200)}Animated`;

    const ass = new ASS({
      assText,
      video: videoElement
    });

    await ass.render();
    const renderer = (ass as any).renderer;

    // At t = 0.5s (500ms into the 1000ms animation):
    // Target is 200, base is 100, t = 0.5 => fscx must be EXACTLY 150 (not 175 from double evaluation!)
    renderer.display(0.5);

    const dialogue = renderer.ppass[0];
    const layer = renderer.layers[0];
    const char = dialogue.chars[0];
    const resolvedFont = renderer.resolveCharStyle(
      char,
      dialogue.alignment,
      layer,
      0.5,
      dialogue.start
    );

    expect(resolvedFont.t.fscx).toBe(150);

    ass.destroy();
  });
});
