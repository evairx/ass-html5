import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ASS from '../src/ass';

describe('HTML5 Controls Protection and Fullscreen Integration (Section 11)', () => {
  let videoElement: HTMLVideoElement;
  let playerHost: HTMLDivElement;

  beforeEach(() => {
    playerHost = document.createElement('div');
    playerHost.id = 'player-host';
    playerHost.style.position = 'relative';
    playerHost.style.width = '1280px';
    playerHost.style.height = '720px';
    document.body.appendChild(playerHost);

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
    playerHost.appendChild(videoElement);

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(cb, 16) as unknown as number;
    });
  });

  afterEach(() => {
    playerHost.remove();
    vi.restoreAllMocks();
  });

  const dummyAss = `[Script Info]
Title: Controls Test
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Bottom Subtitle`;

  it('should not apply clip-path by default even when video.controls is true to keep bottom subtitles visible', async () => {
    videoElement.controls = true;

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    // Disabled by default so bottom subtitles (MarginV) are not cut off
    expect(renderDiv.style.clipPath).toBe('');
    ass.destroy();
  });

  it('should apply 48px clip-path when controlsPadding is explicitly true and image fills container height', async () => {
    videoElement.controls = true;

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: true
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 48px 0px)');
    ass.destroy();
  });

  it('should disable clip-path when controlsPadding is explicitly false or 0', async () => {
    videoElement.controls = true;

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: false
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(renderDiv.style.clipPath).toBe('');
    ass.destroy();
  });

  it('should use custom controlsPadding in pixels', async () => {
    videoElement.controls = true;

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: 64
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 64px 0px)');
    ass.destroy();
  });

  it('should not clip subtitles when letterbox black bars fully contain the controls bar', async () => {
    videoElement.controls = true;
    // 2.35:1 movie letterboxed in 1280x720 (image height is ~544px, black bar is 88px at bottom)
    Object.defineProperty(videoElement, 'videoWidth', { value: 1280 });
    Object.defineProperty(videoElement, 'videoHeight', { value: 544 });

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    // Controls height is 48px, but bottom black bar is (720 - 545) / 2 = 87.5px.
    // The controls sit entirely in the black bar, so subtitles inside the image are NOT clipped!
    expect(renderDiv.style.clipPath).toBe('');
    ass.destroy();
  });

  it('should clip only the overlapping portion when letterbox black bar is smaller than controls', async () => {
    videoElement.controls = true;
    // Video image is 1280x680 in 1280x720. Bottom black bar is (720 - 680) / 2 = 20px.
    // Controls height is 48px, so it intrudes into the video image by 48 - 20 = 28px.
    Object.defineProperty(videoElement, 'videoWidth', { value: 1280 });
    Object.defineProperty(videoElement, 'videoHeight', { value: 680 });

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: true
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 28px 0px)');
    ass.destroy();
  });

  it('should dynamically update clip-path when setControlsPadding is called', async () => {
    videoElement.controls = true;

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;
    expect(renderDiv.style.clipPath).toBe('');

    ass.setControlsPadding(true);
    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 48px 0px)');

    ass.setControlsPadding(32);
    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 32px 0px)');

    ass.setControlsPadding(false);
    expect(renderDiv.style.clipPath).toBe('');

    ass.destroy();
  });

  it('should mount overlay in custom container if provided', async () => {
    const customHost = document.createElement('div');
    customHost.id = 'custom-overlay-host';
    document.body.appendChild(customHost);

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      container: customHost
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(customHost.contains(renderDiv)).toBe(true);

    ass.destroy();
    customHost.remove();
  });

  it('should keep overlay inside host without popover when host container goes fullscreen', async () => {
    videoElement.controls = true;

    // Simulate host container fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: playerHost,
      configurable: true,
      writable: true
    });

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: true
    });

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    // In host fullscreen, overlay stays absolute, does not use Popover API, and uses 56px fullscreen controls padding
    expect(renderDiv.hasAttribute('popover')).toBe(false);
    expect(renderDiv.style.position).toBe('absolute');
    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 56px 0px)');

    ass.destroy();
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true
    });
  });

  it('should use popover when video element itself is fullscreen and clean up on exit', async () => {
    videoElement.controls = true;

    // Simulate video element native fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: videoElement,
      configurable: true,
      writable: true
    });

    const ass = new ASS({
      assText: dummyAss,
      video: videoElement,
      controlsPadding: true
    });

    // Mock Popover API methods if not in jsdom
    HTMLDivElement.prototype.showPopover = vi.fn();
    HTMLDivElement.prototype.hidePopover = vi.fn();

    await ass.render();
    const renderDiv = (ass as any).renderer.renderDiv as HTMLDivElement;

    expect(renderDiv.getAttribute('popover')).toBe('manual');
    expect(renderDiv.style.position).toBe('fixed');
    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 56px 0px)');

    // Exit video fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true
    });
    (ass as any).setCanvasSize();

    expect(renderDiv.hasAttribute('popover')).toBe(false);
    expect(renderDiv.style.position).toBe('absolute');
    expect(renderDiv.style.clipPath).toBe('inset(0px 0px 48px 0px)');

    ass.destroy();
  });
});
