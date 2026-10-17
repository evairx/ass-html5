import { describe, it, expect, beforeEach, vi } from 'vitest';
import ASS from '../src/ass';
import { interpolateColor, blendAlpha, parseAlpha, parseFontMetrics } from '../src/utils';

describe('Render Quality and Font Metrics', () => {
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
    renderer.render(0);

    // Stroke had the blur filter applied
    expect(strokeFilter).toContain('blur');
    // Fill text MUST NOT inherit the stroke's blur or shadow
    expect(fillFilter).toBe('none');
    expect(['transparent', 'rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 0.00)']).toContain(fillShadow);

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    ass.destroy();
  });

  it('should interpolate colors accurately', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(interpolateColor('#ff0000', '#00ff00', 0.5)).toBe('#808000');
  });

  it('should blendAlpha correctly with edge cases and missing color', () => {
    expect(blendAlpha('#ffffff', 0)).toBe('rgba(255, 255, 255, 1.000)');
    expect(blendAlpha('#ffffff', 255)).toBe('rgba(255, 255, 255, 0.000)');
    expect(blendAlpha('', 0)).toBe('rgba(0, 0, 0, 1.000)');
  });

  it('should parse alpha values safely and correctly', () => {
    expect(parseAlpha(128)).toBe(128);
    expect(parseAlpha('&H80')).toBe(128);
    expect(parseAlpha('&H80&')).toBe(128);
    expect(parseAlpha('')).toBe(0);
    expect(parseAlpha(undefined)).toBe(0);
    expect(parseAlpha('invalid')).toBe(0);
  });

  it('should recognize ASS Bold: -1 and override tags as bold', async () => {
    const assText = `[Script Info]
Title: Bold Recognition Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Bold Text`;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let recordedFont = '';

    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      const ctx = originalGetContext.apply(this, [type]) as CanvasRenderingContext2D;
      if (type === '2d') {
        const origFill = ctx.fillText;
        ctx.fillText = function (...args: any[]) {
          recordedFont = this.font;
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
    renderer.render(0);

    expect(recordedFont).toContain('bold');

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    ass.destroy();
  });

  it('should parse font metrics from TTF tables and compute correct OS/2 ratio', () => {
    const buffer = new ArrayBuffer(256);
    const view = new DataView(buffer);

    view.setUint32(0, 0x00010000);
    view.setUint16(4, 2);

    // Table 1: 'head'
    view.setUint8(12, 'h'.charCodeAt(0));
    view.setUint8(13, 'e'.charCodeAt(0));
    view.setUint8(14, 'a'.charCodeAt(0));
    view.setUint8(15, 'd'.charCodeAt(0));
    view.setUint32(20, 64);
    view.setUint32(24, 54);

    // Table 2: 'OS/2'
    view.setUint8(28, 'O'.charCodeAt(0));
    view.setUint8(29, 'S'.charCodeAt(0));
    view.setUint8(30, '/'.charCodeAt(0));
    view.setUint8(31, '2'.charCodeAt(0));
    view.setUint32(36, 128);
    view.setUint32(40, 96);

    // 'head' table: unitsPerEm at offset 18 = 2048
    view.setUint16(64 + 18, 2048);

    // 'OS/2' table: usWinAscent at offset 74 = 1800, usWinDescent at offset 76 = 500
    // total cell height = 2300. ratio = 2048 / 2300 ≈ 0.8904
    view.setUint16(128 + 74, 1800);
    view.setUint16(128 + 76, 500);

    const metrics = parseFontMetrics(buffer);
    expect(metrics.unitsPerEm).toBe(2048);
    expect(metrics.winAscent).toBe(1800);
    expect(metrics.winDescent).toBe(500);
    expect(metrics.ratio).toBeCloseTo(2048 / 2300, 4);
  });
});
