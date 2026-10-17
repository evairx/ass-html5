import type { CompiledASS, CompiledASSStyle, Dialogue, DialogueSlice } from 'ass-compiler';
import type { CompiledTag } from 'ass-compiler/types/tags';

import type {
  StyleDescriptor,
  Styles,
  Position,
  OnInitSizes,
  Layer,
  Margin,
  Char,
  Word,
  FadeAnimation,
  CustomAnimation,
  Karaoke,
  Drawing,
  Clip,
  Rect
} from './types';
import { CHARKIND, LOGTYPE, Align, Baseline, FadeKind } from './types';
import {
  ruleOfThree,
  blendAlpha,
  convertAegisubColorToHex,
  swapBBGGRR,
  newCanvas,
  newRender,
  Vector2,
  stringHash,
  chunkCharWidth,
  chunkCharToString,
  vectorLerp,
  getOpacity,
  getOpacityComplex,
  lerp,
  parseAlpha,
  interpolateColor
} from './utils';

type PreProceesedAss = {
  start: number;
  layer: number;
  end: number;
  style: string;
  margin: Margin;
  pos?: Position;
  move?: MoveAnimation;
  fade?: FadeAnimation;
  rotationOrigin?: Vector2;
  alignment: number;
  chars: Char[];
  clip?: Clip;
  q: number;
  animated: boolean;
};

type MoveAnimation = {
  // x1: number;
  // y1: number;
  from: Vector2;
  // x2: number;
  //y2: number;
  to: Vector2;
  // t1: number;
  start: number;
  //t2: number;
  end: number;
};

export class Renderer {
  private compiledASS: CompiledASS;
  renderDiv: HTMLDivElement;
  layers: Layer[];
  private numberOfLayers: number;
  private video: HTMLVideoElement;
  private playerResX: number;
  private playerResY: number;
  private stop: boolean = false;
  private animationHandle: number | null = null;
  private _log: LOGTYPE;
  private ppass: PreProceesedAss[] = [];
  private styles: Styles;
  // private previous = 0;
  currentTime = 0;
  private occupiedRects: Map<number, Rect[]> = new Map();
  private lastActiveDialogueHashes: Map<number, string> = new Map();
  private _nativeLetterSpacing?: boolean;
  private fontRatios: Map<string, number> = new Map();

  setFontRatios(ratios: Map<string, number>) {
    this.fontRatios = ratios;
    this.invalidate();
  }

  private getFontRatio(fontname: string): number {
    if (this.fontRatios && this.fontRatios.size > 0) {
      const clean = fontname
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase();
      const base = clean
        .replace(/\s+(semibold|bold|regular|light|medium|black|italic)/i, '')
        .trim();
      if (this.fontRatios.has(clean)) return this.fontRatios.get(clean)!;
      if (this.fontRatios.has(base)) return this.fontRatios.get(base)!;
      for (const [key, val] of this.fontRatios.entries()) {
        if (clean.includes(key) || key.includes(clean)) return val;
      }
    }
    // Typographic default for standard Windows GDI / TrueType fonts (Arial cell height ratio ≈ 0.895)
    return 0.895;
  }

  private upscaleFontSize(fs: number, fontname: string): number {
    const base = this.upscale(
      fs,
      this.playerResY,
      this.layers[0]?.canvas.height || this.playerResY
    );
    return base * this.getFontRatio(fontname);
  }

  private supportsNativeLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
    if (this._nativeLetterSpacing !== undefined) return this._nativeLetterSpacing;
    try {
      if (typeof ctx.letterSpacing !== 'string') {
        this._nativeLetterSpacing = false;
        return false;
      }
      const saved = ctx.letterSpacing;
      ctx.letterSpacing = '0px';
      const w0 = ctx.measureText('M').width;
      ctx.letterSpacing = '10px';
      const w1 = ctx.measureText('M').width;
      ctx.letterSpacing = saved;
      this._nativeLetterSpacing = Math.abs(w1 - w0 - 10) < 0.1;
      return this._nativeLetterSpacing;
    } catch {
      this._nativeLetterSpacing = false;
      return false;
    }
  }

  constructor(
    ass: CompiledASS,
    sizes: OnInitSizes,
    video: HTMLVideoElement,
    log: LOGTYPE,
    zIndex?: number,
    fontRatios?: Map<string, number>,
    container?: HTMLElement | null
  ) {
    this._log = log;
    this.compiledASS = ass;
    this.styles = ass.styles;
    if (fontRatios) {
      this.fontRatios = fontRatios;
    }
    if (this._log === 'DEBUG') {
      this.log('DEBUG', this.compiledASS);
    }
    const rawY = this.compiledASS.height || 0;
    const rawX = this.compiledASS.width || 0;
    if (rawX && rawY) {
      this.playerResX = rawX;
      this.playerResY = rawY;
    } else if (rawY) {
      this.playerResY = rawY;
      this.playerResX = Math.round((rawY * 4) / 3);
    } else if (rawX) {
      this.playerResX = rawX;
      this.playerResY = Math.round((rawX * 3) / 4);
    } else {
      this.playerResX = 384;
      this.playerResY = 288;
    }
    this.renderDiv = newRender(
      sizes.y,
      sizes.x,
      sizes.width,
      sizes.height,
      zIndex,
      video,
      container ?? undefined
    );
    const canvas = newCanvas(sizes.width, sizes.height, 0, 'subtitles', this.renderDiv);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (ctx === null) {
      throw new Error('Unable to initilize the Canvas 2D context');
    }
    //@ts-ignore
    ctx.textRendering = 'geometricPrecision';

    this.layers = [
      {
        canvas,
        ctx
      }
    ];

    this.numberOfLayers = 1;
    this.video = video;
  }

  private insertLayers() {}

  private getLayer(_l?: number): Layer | null {
    return this.layers[0] || null;
  }

  private findTotalLayers(_ass: CompiledASS) {
    return 1;
  }

  async warmup() {
    const { dialogues } = this.compiledASS;
    const canvas = document.createElement('canvas');
    canvas.height = this.playerResY;
    canvas.width = this.playerResX;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    // @ts-ignore
    ctx.textRendering = 'geometricPrecision';
    const computelayer: Layer = {
      ctx,
      canvas
    };

    computelayer.canvas.width = this.playerResX;
    computelayer.canvas.height = this.playerResY;

    for (let i = 0; i < dialogues.length; i++) {
      const dia = dialogues[i] as Dialogue;
      const { layer, alignment, start, end, style, margin, slices, pos, move, org, fade, q } = dia;
      const clip = (dia as any).clip as Clip | undefined;
      let movAnim: MoveAnimation | undefined;
      let rotOrg: Vector2 | undefined;
      let fadeAnim: FadeAnimation | undefined;

      if (move) {
        movAnim = {
          from: new Vector2(move.x1, move.y1),
          to: new Vector2(move.x2, move.y2),
          start: move.t1,
          end: move.t2
        };
      }

      if (org) {
        rotOrg = new Vector2(org.x, org.y);
      }

      if (fade) {
        switch (fade.type) {
          case 'fad':
            fadeAnim = { type: FadeKind.Simple, fadein: fade.t1, fadeout: fade.t2 };
            break;
          case 'fade':
            let { a1, a2, a3, t1, t2, t3, t4 } = fade;
            fadeAnim = { type: FadeKind.Complex, a1, a2, a3, t1, t2, t3, t4 };
            break;
        }
      }

      const chars = this.processSlices(alignment, slices, computelayer);
      const isAnimated =
        !!(movAnim || fadeAnim) ||
        chars.some(
          (c) =>
            (c.kind === CHARKIND.NORMAL && (!!c.tag.t || !!c.karaoke)) ||
            (c.kind === CHARKIND.DRAWING && !!c.tag.t)
        );

      this.ppass.push({
        start,
        layer,
        end,
        style,
        margin,
        alignment,
        pos,
        move: movAnim,
        fade: fadeAnim,
        rotationOrigin: rotOrg,
        chars,
        clip,
        q,
        animated: isAnimated
      });
    }
  }

  private processSlices(alignment: number, slices: DialogueSlice[], layer: Layer): Char[] {
    let chars: Char[] = [];
    let currentKaraokeTime = 0;
    slices.forEach((slice) => {
      const { style, fragments } = slice;
      let font = this.computeStyle(style, alignment, layer);

      let _frag: Char[] = [];

      fragments.forEach((frag) => {
        this.applyOverrideTag(frag.tag, font);
        this.applyFont(font, layer);

        // Karaoke Logic
        const tag = frag.tag as any;
        let kMode: 'k' | 'kf' | 'ko' | 'K' | null = null;
        let kVal = 0;
        if (tag.k !== undefined) {
          kMode = 'k';
          kVal = tag.k;
        } else if (tag.kf !== undefined) {
          kMode = 'kf';
          kVal = tag.kf;
        } else if (tag.ko !== undefined) {
          kMode = 'ko';
          kVal = tag.ko;
        } else if (tag.K !== undefined) {
          kMode = 'K';
          kVal = tag.K;
        }

        let karaoke: Karaoke | undefined;
        if (kMode !== null) {
          karaoke = {
            type: kMode,
            start: currentKaraokeTime,
            end: currentKaraokeTime + kVal / 100
          };
          currentKaraokeTime += kVal / 100;
        }

        //@ts-ignore
        const text = frag.text.replaceAll('\\N', '\n').replaceAll('\\h', '\u00A0').split('');
        const drawing = (frag as any).drawing as Drawing | undefined;

        let ord = 0;
        let chars: Char[] = [];

        if (drawing) {
          const scale = (frag.tag as any).p || 0;
          // If scale is 0, it's not a drawing (usually disabled), but if drawing object exists, it might be.
          // However, ass-compiler usually returns drawing object only if valid.
          // But p0 disables drawing. So check scale != 0.
          if (scale > 0) {
            const cachedPath =
              typeof Path2D !== 'undefined' ? new Path2D(drawing.d) : ({} as Path2D);
            chars.push({
              kind: CHARKIND.DRAWING,
              pos: new Vector2(),
              w: drawing.width * Math.pow(2, -(scale - 1)),
              h: drawing.height * Math.pow(2, -(scale - 1)),
              tag: frag.tag,
              style,
              drawing,
              scale,
              path: cachedPath
            });
          }
        } else {
          for (let i = 0; i < text.length; i++) {
            const char = text[i] as string;
            if (char == '\n') {
              chars.push({
                kind: CHARKIND.NEWLINE
              });
              ord = 0;
            } else {
              chars.push({
                kind: CHARKIND.NORMAL,
                pos: new Vector2(),
                c: char,
                ord,
                w: 0,
                style,
                tag: frag.tag,
                karaoke
              });

              ord += 1;
            }
          }
        }

        _frag = _frag.concat(chars);
      });

      chars = chars.concat(_frag);
    });

    return chars;
  }

  private sublog(type: LOGTYPE, ...message: any) {
    switch (type) {
      case 'DISABLE':
        break;
      case 'VERBOSE':
        console.info(type, ...message);
        break;
      case 'DEBUG':
        console.debug(type, ...message);
        break;
      case 'WARN':
        console.warn(type, ...message);
        break;
    }
  }

  private log(type: LOGTYPE, ...message: any) {
    switch (this._log) {
      case 'DISABLE':
        break;
      case 'VERBOSE':
        this.sublog(type, message);
        break;
      case 'DEBUG':
        if (type == 'DEBUG') {
          this.sublog(type, message);
        }
        break;
      case 'WARN':
        if (type == 'WARN') {
          this.sublog(type, message);
        }
        break;
    }
  }

  async startRendering() {
    window.requestAnimationFrame((_timestamp) => {
      // this.previous = timestamp;
      this.animationHandle = requestAnimationFrame(this.render.bind(this));
    });
  }

  private render(_timestamp: number) {
    if (this.stop === true) {
      if (this.animationHandle) {
        this.renderDiv.remove();
        cancelAnimationFrame(this.animationHandle);
      }
    } else {
      // this.dt = (timestamp - this.previous) / 1000.0;
      // this.previous = timestamp;
      this.display(this.video.currentTime);
      this.animationHandle = requestAnimationFrame(this.render.bind(this));
    }
  }

  destroy() {
    this.stop = true;
    if (this.animationHandle) {
      cancelAnimationFrame(this.animationHandle);
    }
    if ('hidePopover' in this.renderDiv && this.renderDiv.hasAttribute('popover')) {
      try {
        this.renderDiv.hidePopover();
      } catch {}
    }
    this.renderDiv.remove();
  }

  forceRender(time?: number) {
    this.display(time ?? this.video.currentTime, true);
  }

  private display(time: number, force = false) {
    this.currentTime = time;
    const slicesToDisplay = this.getSlices(time);

    const hasAnimated = slicesToDisplay.some((d) => d.animated);
    const dialogueIds = slicesToDisplay.map((d) => this.ppass.indexOf(d)).join(',');
    const stateHash = hasAnimated ? `animated-${time}` : `static-${dialogueIds}`;

    const lastHash = this.lastActiveDialogueHashes.get(0);
    if (!force && stateHash === lastHash) {
      return;
    }
    this.lastActiveDialogueHashes.set(0, stateHash);

    const mainLayer = this.layers[0];
    if (!mainLayer) return;

    mainLayer.ctx.clearRect(0, 0, mainLayer.canvas.width, mainLayer.canvas.height);
    if (slicesToDisplay.length === 0) return;

    // In ASS, dialogues are rendered in ascending layer order (layer 0 first, then 1, 2, ...).
    // Stable sort preserves original script index for dialogues on the same layer.
    const sorted = [...slicesToDisplay].sort((a, b) => a.layer - b.layer);

    this.occupiedRects.clear();
    sorted.forEach((d) => {
      this.showDialogue(d, time);
    });
  }

  // private charsToString(chars: Char[]): string {
  //   return chars.reduce((acc, v) => {
  //     if (v.kind === CHARKIND.NEWLINE) return acc + '\n';
  //     if (v.kind === CHARKIND.NORMAL) return acc + v.c;
  //     return acc;
  //   }, '');
  // }

  private getSlices(time: number): PreProceesedAss[] {
    return this.ppass.filter((dialogue) => {
      return dialogue.start <= time && dialogue.end >= time;
    });
  }

  private applyCustomAnimations(font: StyleDescriptor, time?: number, startTime?: number) {
    if (time === undefined || startTime === undefined || !font.customAnimations?.length) {
      return;
    }
    const cur = time * 1000;
    for (let i = 0; i < font.customAnimations.length; i++) {
      const ca = font.customAnimations[i] as CustomAnimation;
      const start = startTime * 1000 + ca.t1;
      const end = startTime * 1000 + ca.t2;
      if (cur < start) continue;
      let t = end <= start ? 1 : Math.min(1, Math.max(0, (cur - start) / (end - start)));
      if (ca.accel !== 1) {
        t = Math.pow(t, ca.accel);
      }

      for (const field in ca.tag) {
        switch (field) {
          case 'a1':
          case 'a2':
          case 'a3':
          case 'a4': {
            const targetAlpha = parseAlpha((ca.tag as any)[field] as string);
            const baseAlpha = font.colors[field] ?? 0;
            font.colors[field] = Math.round(lerp(baseAlpha, targetAlpha, t));
            break;
          }
          case 'c1':
          case 'c2':
          case 'c3':
          case 'c4': {
            const targetHex = swapBBGGRR((ca.tag as any)[field] as string);
            const baseHex = font.colors[field] || '#000000';
            font.colors[field] = interpolateColor(baseHex, targetHex, t);
            break;
          }
          case 'blur':
          case 'be':
          case 'xshad':
          case 'yshad':
          case 'xbord':
          case 'ybord':
            font[field] = lerp(font[field] ?? 0, (ca.tag as any)[field] as number, t);
            break;
          case 'fax':
          case 'fay':
          case 'frx':
          case 'fry':
          case 'frz':
            font.t[field] = lerp(font.t[field] ?? 0, (ca.tag as any)[field] as number, t);
            break;
          case 'fscx':
          case 'fscy':
            font.t[field] = lerp(font.t[field] ?? 100, (ca.tag as any)[field] as number, t);
            break;
          case 'fs': {
            const targetFs = this.upscaleFontSize((ca.tag as any).fs as number, font.fontname);
            font.fontsize = lerp(font.fontsize, targetFs, t);
            break;
          }
          case 'fsp': {
            const targetFsp = this.upscale(
              (ca.tag as any).fsp as number,
              this.playerResX,
              this.layers[0]?.canvas.width || this.playerResX
            );
            font.t.fsp = lerp(font.t.fsp ?? 0, targetFsp, t);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  private resolveCharStyle(
    char: Extract<Char, { style: string; tag: CompiledTag }>,
    alignment: number,
    layer: Layer,
    time?: number,
    startTime?: number
  ): StyleDescriptor {
    const font = this.computeStyle(char.style, alignment, layer);
    this.applyOverrideTag(char.tag, font);
    if (time !== undefined && startTime !== undefined) {
      this.applyCustomAnimations(font, time, startTime);
    }
    return font;
  }

  private getLineMetrics(layer: Layer, lines: Char[][], time?: number, startTime?: number) {
    return lines.map((line) => {
      let maxAscent = 0;
      let maxDescent = 0;

      line.forEach((char) => {
        if (char.kind === CHARKIND.NORMAL) {
          let font = this.resolveCharStyle(char, 1, layer, time, startTime);
          this.applyFont(font, layer);

          const scaleY = (font.t.fscy ?? 100) / 100;
          const tiltY = font.t.frx ? Math.abs(Math.cos((font.t.frx * Math.PI) / 180)) : 1;
          const totalScaleY = scaleY * tiltY;

          const m = layer.ctx.measureText(char.c);
          const rawAscent =
            m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || font.fontsize * 0.8;
          const rawDescent =
            m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || font.fontsize * 0.2;

          const ascent = rawAscent * totalScaleY;
          const descent = rawDescent * totalScaleY;

          if (ascent > maxAscent) maxAscent = ascent;
          if (descent > maxDescent) maxDescent = descent;
        } else if (char.kind === CHARKIND.DRAWING) {
          const Yratio = layer.canvas.height / this.playerResY;
          const pScale = Math.pow(2, -(char.scale - 1));
          let font = this.resolveCharStyle(char, 1, layer, time, startTime);
          const fscy = (font.t?.fscy ?? 100) / 100;

          const h = char.drawing.height * pScale * fscy * Yratio;

          if (h > maxAscent) maxAscent = h;
        }
      });

      return {
        ascent: maxAscent,
        height: maxAscent + maxDescent
      };
    });
  }

  private measureChar(layer: Layer, char: Char, time?: number, startTime?: number): number {
    if (char.kind === CHARKIND.NORMAL) {
      let font = this.resolveCharStyle(char, 1, layer, time, startTime);
      this.applyFont(font, layer);
      const scaleX = (font.t.fscx ?? 100) / 100;
      const tiltX = font.t.fry ? Math.abs(Math.cos((font.t.fry * Math.PI) / 180)) : 1;
      const totalScaleX = scaleX * tiltX;
      const nativeLs = this.supportsNativeLetterSpacing(layer.ctx);
      const spacing = nativeLs ? 0 : (font.t.fsp ?? 0) * totalScaleX;
      return layer.ctx.measureText(char.c).width * totalScaleX + spacing;
    } else if (char.kind === CHARKIND.DRAWING) {
      return char.w;
    }
    return 0;
  }

  private lineWidth(layer: Layer, chars: Char[], time?: number, startTime?: number) {
    if (chars.length === 0) return 0;

    let w = 0;
    let currentChunk: Char[] = [];
    let currentHash: number | null = null;
    let currentFont: StyleDescriptor | null = null;

    const flushChunk = () => {
      if (currentChunk.length === 0 || currentFont === null) return;
      const head = currentChunk[0]!;
      if (head.kind === CHARKIND.NORMAL) {
        this.applyFont(currentFont, layer);
        const str = currentChunk.map((c) => (c.kind === CHARKIND.NORMAL ? c.c : '')).join('');
        const scaleX = (currentFont.t.fscx ?? 100) / 100;
        const tiltX = currentFont.t.fry
          ? Math.abs(Math.cos((currentFont.t.fry * Math.PI) / 180))
          : 1;
        const totalScaleX = scaleX * tiltX;
        const fsp = (currentFont.t.fsp ?? 0) * totalScaleX;
        if (this.supportsNativeLetterSpacing(layer.ctx)) {
          w += layer.ctx.measureText(str).width * totalScaleX - (currentChunk.length > 0 ? fsp : 0);
        } else {
          w +=
            layer.ctx.measureText(str).width * totalScaleX +
            fsp * Math.max(0, currentChunk.length - 1);
        }
      } else if (head.kind === CHARKIND.DRAWING) {
        currentChunk.forEach((c) => {
          if (c.kind === CHARKIND.DRAWING) {
            w += c.w;
          }
        });
      }
      currentChunk = [];
    };

    chars.forEach((char) => {
      if (char.kind === CHARKIND.NORMAL) {
        let font = this.resolveCharStyle(char, 1, layer, time, startTime);
        const fHash = this.getFontHash(font);
        if (currentHash !== fHash) {
          flushChunk();
          currentHash = fHash;
          currentFont = font;
        }
        currentChunk.push(char);
      } else if (char.kind === CHARKIND.DRAWING) {
        flushChunk();
        currentHash = null;
        currentFont = null;
        w += char.w;
      }
    });

    flushChunk();
    return Math.max(0, w);
  }

  private lines(
    chars: Char[],
    layer: Layer,
    q: number,
    maxWidth: number,
    time?: number,
    startTime?: number
  ): Char[][] {
    let lines: Char[][] = [];
    let currentLine: Char[] = [];
    let currentLineWidth = 0;

    // q2: No wrapping (except \N)
    if (q === 2) {
      chars.forEach((char) => {
        if (char.kind === CHARKIND.NEWLINE) {
          lines.push(currentLine);
          currentLine = [];
        } else {
          currentLine.push(char);
        }
      });
      if (currentLine.length > 0) lines.push(currentLine);
      return lines;
    }

    // q0, q1, q3: Greedy wrapping
    let lastSafeBreakIndex = -1;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!;

      if (char.kind === CHARKIND.NEWLINE) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
        lastSafeBreakIndex = -1;
        continue;
      }

      const charWidth = this.measureChar(layer, char, time, startTime);

      // Check if we need to wrap
      if (currentLineWidth + charWidth > maxWidth && currentLine.length > 0) {
        if (lastSafeBreakIndex !== -1) {
          // Break at the last space
          const line1 = currentLine.slice(0, lastSafeBreakIndex + 1);
          const overflowChars = currentLine.slice(lastSafeBreakIndex + 1);

          lines.push(line1);

          currentLine = overflowChars;
          // Recalculate width for the new line start
          currentLineWidth = this.lineWidth(layer, currentLine, time, startTime);
          lastSafeBreakIndex = -1;
        } else {
          // No break point found
          // Standard ASS behavior for q1 is to overflow if a single word is too long.
        }
      }

      currentLine.push(char);
      currentLineWidth += charWidth;

      if (char.kind === CHARKIND.NORMAL && char.c === ' ') {
        lastSafeBreakIndex = currentLine.length - 1;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines;
  }

  private showDialogue(d: PreProceesedAss, time: number) {
    const layer = this.getLayer(d.layer);
    if (!layer) return;

    layer.ctx.save();
    if (d.clip) {
      let activeClip = d.clip;
      for (const char of d.chars) {
        if (char.kind !== CHARKIND.NEWLINE && char.tag.t) {
          for (const anim of char.tag.t) {
            if ((anim.tag as any).clip) {
              const start = d.start * 1000 + anim.t1;
              const end = d.start * 1000 + anim.t2;
              const cur = time * 1000;
              if (cur < start) continue;
              let t = end <= start ? 1 : Math.min(1, Math.max(0, (cur - start) / (end - start)));
              if (anim.accel !== 1) t = Math.pow(t, anim.accel);

              activeClip = this.interpolateClip(d.clip, (anim.tag as any).clip as Clip, t);
              break;
            }
          }
        }
      }
      this.applyClip(activeClip, layer);
    }

    let font = this.computeStyle(d.style, d.alignment, layer);

    const margin = this.upscaleMargin(d.margin);
    const maxWidth = layer.canvas.width - margin.left - margin.right;

    const lines = this.lines(d.chars, layer, d.q, maxWidth, time, d.start);
    const lineMetrics = this.getLineMetrics(layer, lines, time, d.start);
    const totalHeight = lineMetrics.reduce((acc, m) => acc + m.height, 0);

    let cX = 0;
    let cY = 0;
    let baseX = 0;
    let currentOpacity = 1;

    let customPosition = false;
    let rotationOrigin: Vector2 | undefined;
    const Xratio = layer.canvas.width / this.playerResX;
    const Yratio = layer.canvas.height / this.playerResY;

    if (d.pos) {
      customPosition = true;
      baseX = d.pos.x * Xratio;
      cX = baseX;
      cY = d.pos.y * Yratio;
    }

    if (d.move) {
      customPosition = true;

      let startPosition = new Vector2(d.move.from.x * Xratio, d.move.from.y * Yratio);
      let endPosition = new Vector2(d.move.to.x * Xratio, d.move.to.y * Yratio);

      const relTimeMs = (time - d.start) * 1000;
      const moveStart = d.move.start ?? 0;
      const moveEnd = d.move.end ?? (d.end - d.start) * 1000;
      let moveProgress = 0;
      if (moveEnd <= moveStart) {
        moveProgress = 1;
      } else if (relTimeMs <= moveStart) {
        moveProgress = 0;
      } else if (relTimeMs >= moveEnd) {
        moveProgress = 1;
      } else {
        moveProgress = (relTimeMs - moveStart) / (moveEnd - moveStart);
      }

      let actualPosition = vectorLerp(startPosition, endPosition, moveProgress);

      baseX = actualPosition.x;
      cX = baseX;
      cY = actualPosition.y;
    }

    if (d.rotationOrigin) {
      rotationOrigin = new Vector2(d.rotationOrigin.x * Xratio, d.rotationOrigin.y * Yratio);
    } else {
      // Default origin is the anchor point
      let defaultOriginX = baseX;
      let defaultOriginY = cY;

      if (!customPosition) {
        // Alignment-based anchor on screen
        if (font.textAlign === Align.Left) defaultOriginX = margin.left;
        else if (font.textAlign === Align.Center) defaultOriginX = layer.canvas.width / 2;
        else if (font.textAlign === Align.Right) defaultOriginX = layer.canvas.width - margin.right;

        if (font.textBaseline === Baseline.Top) defaultOriginY = margin.vertical;
        else if (font.textBaseline === Baseline.Middle) defaultOriginY = layer.canvas.height / 2;
        else if (font.textBaseline === Baseline.Bottom)
          defaultOriginY = layer.canvas.height - margin.vertical;
      }
      rotationOrigin = new Vector2(defaultOriginX, defaultOriginY);
    }

    if (d.fade) {
      switch (d.fade.type) {
        case FadeKind.Simple:
          currentOpacity = getOpacity(d.fade, d.start * 1000, d.end * 1000, time * 1000);
          break;
        case FadeKind.Complex:
          currentOpacity = getOpacityComplex(d.fade, d.start * 1000, d.end * 1000, time * 1000);
          break;
      }
    }

    let offsetY = 0; // vertical offset based on Alignment (Top/Middle/Bottom)
    if (!customPosition) {
      switch (font.textBaseline) {
        case Baseline.Bottom:
          // Shift UP from bottom: CanvasHeight - Margin - TotalHeight
          offsetY = layer.canvas.height - margin.vertical - totalHeight;
          break;
        case Baseline.Middle:
          // Shift to Middle: (CanvasHeight/2) - (TotalHeight/2)
          offsetY = (layer.canvas.height - totalHeight) / 2;
          break;
        case Baseline.Top:
          // Shift Down: Margin
          offsetY = margin.vertical;
          break;
        default:
          offsetY = layer.canvas.height - margin.vertical - totalHeight;
          break;
      }

      // Collision Resolution
      const layerRects = this.occupiedRects.get(d.layer) || [];
      const rect: Rect = {
        x: margin.left,
        y: offsetY,
        w: layer.canvas.width - margin.left - margin.right,
        h: totalHeight
      };

      const direction = font.textBaseline === Baseline.Top ? 1 : -1;
      let collision = true;
      while (collision) {
        collision = false;
        for (const other of layerRects) {
          if (this.intersects(rect, other)) {
            collision = true;
            break;
          }
        }
        if (collision) {
          rect.y += direction;
        }
      }
      offsetY = rect.y;
      layerRects.push(rect);
      this.occupiedRects.set(d.layer, layerRects);
    } else {
      switch (font.textBaseline) {
        case Baseline.Bottom:
          offsetY = -totalHeight;
          break;
        case Baseline.Middle:
          offsetY = -totalHeight / 2;
          break;
        default:
          offsetY = 0;
          break;
      }
    }

    let words: Word[] = [];

    lines.forEach((line, lineIdx) => {
      const lineWidth = this.lineWidth(layer, line, time, d.start);
      let offsetX = 0;

      if (!customPosition) {
        switch (font.textAlign) {
          case Align.Left:
            offsetX = margin.left;
            break;
          case Align.Center:
            offsetX = (layer.canvas.width - lineWidth) / 2;
            break;
          case Align.Right:
            offsetX = layer.canvas.width - lineWidth - margin.right;
            break;
          default:
            offsetX = margin.left;
        }
      } else {
        switch (font.textAlign) {
          case Align.Center:
            offsetX = -lineWidth / 2;
            break;
          case Align.Right:
            offsetX = -lineWidth;
            break;
          default:
            offsetX = 0;
            break;
        }
      }

      cX = baseX + offsetX;

      const metrics = lineMetrics[lineIdx]!;
      let lineY = cY + offsetY;

      // We need to accumulate height of previous lines to find current line top.
      for (let i = 0; i < lineIdx; i++) {
        lineY += lineMetrics[i]!.height;
      }
      // lineY is now the TOP of the current line box.
      // Baseline is lineY + ascent.
      const baseline = lineY + metrics.ascent;

      let currentWord: Char[] = [];
      let currentFont: StyleDescriptor | null = null;
      let currentHash: number | null = null;

      const flushWord = () => {
        if (currentWord.length === 0 || currentFont === null) return;
        const head = currentWord[0]!;
        if (head.kind === CHARKIND.NORMAL) {
          this.applyFont(currentFont, layer);
          const str = currentWord.map((c) => (c.kind === CHARKIND.NORMAL ? c.c : '')).join('');
          const scaleX = (currentFont.t.fscx ?? 100) / 100;
          const tiltX = currentFont.t.fry
            ? Math.abs(Math.cos((currentFont.t.fry * Math.PI) / 180))
            : 1;
          const totalScaleX = scaleX * tiltX;
          const fsp = (currentFont.t.fsp ?? 0) * totalScaleX;
          const nativeLs = this.supportsNativeLetterSpacing(layer.ctx);
          const wordWidth = nativeLs
            ? layer.ctx.measureText(str).width * totalScaleX - (currentWord.length > 0 ? fsp : 0)
            : layer.ctx.measureText(str).width * totalScaleX +
              fsp * Math.max(0, currentWord.length - 1);

          for (let i = 0; i < currentWord.length; i++) {
            const char = currentWord[i]!;
            if (char.kind === CHARKIND.NORMAL) {
              const prefix = str.slice(0, i);
              let prefixWidth = 0;
              if (i > 0) {
                prefixWidth = nativeLs
                  ? layer.ctx.measureText(prefix).width * totalScaleX
                  : layer.ctx.measureText(prefix).width * totalScaleX + fsp * (i - 1);
              }
              char.pos.x = cX + prefixWidth;
              char.pos.y = baseline;
              const nextPrefix = str.slice(0, i + 1);
              const nextPrefixWidth =
                i === currentWord.length - 1
                  ? wordWidth
                  : nativeLs
                    ? layer.ctx.measureText(nextPrefix).width * totalScaleX
                    : layer.ctx.measureText(nextPrefix).width * totalScaleX + fsp * i;
              char.w = nextPrefixWidth - prefixWidth;
            }
          }

          words.push({
            font: currentFont,
            value: currentWord,
            w: wordWidth
          });

          cX += wordWidth;
        } else if (head.kind === CHARKIND.DRAWING) {
          let dwTotal = 0;
          currentWord.forEach((char) => {
            if (char.kind === CHARKIND.DRAWING) {
              char.pos.x = cX + dwTotal;
              dwTotal += char.w;
            }
          });
          words.push({
            font: currentFont,
            value: currentWord,
            w: dwTotal
          });
          cX += dwTotal;
        }
        currentWord = [];
      };

      line.forEach((char) => {
        if (char.kind === CHARKIND.NORMAL) {
          font = this.resolveCharStyle(char, d.alignment, layer, time, d.start);
          const fHash = this.getFontHash(font);
          if (currentHash !== fHash) {
            flushWord();
            currentHash = fHash;
            currentFont = font;
          }
          currentWord.push(char);
        } else if (char.kind === CHARKIND.DRAWING) {
          font = this.resolveCharStyle(char, d.alignment, layer, time, d.start);
          const pScale = Math.pow(2, -(char.scale - 1));
          const fscx = (font.t.fscx ?? 100) / 100;
          const fscy = (font.t.fscy ?? 100) / 100;
          char.w = char.drawing.width * pScale * fscx * Xratio;
          const dh = char.drawing.height * pScale * fscy * Yratio;
          char.pos.y = baseline - dh;

          flushWord();
          currentHash = null;
          currentFont = font;
          currentWord = [char];
          flushWord();
        }
      });

      flushWord();
    });

    words.forEach((word) => {
      word.font.opacity = currentOpacity;
      layer.ctx.save();
      this.drawWord(word, time, d.start, layer, rotationOrigin);
      layer.ctx.restore();
    });

    layer.ctx.restore();
  }

  private intersects(r1: Rect, r2: Rect): boolean {
    return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
  }

  private applyClip(clip: Clip, layer: Layer) {
    const ctx = layer.ctx;
    const Xratio = layer.canvas.width / this.playerResX;
    const Yratio = layer.canvas.height / this.playerResY;

    if (clip.dots) {
      const { x1, y1, x2, y2 } = clip.dots;
      const x = x1 * Xratio;
      const y = y1 * Yratio;
      const w = (x2 - x1) * Xratio;
      const h = (y2 - y1) * Yratio;

      ctx.beginPath();
      if (clip.inverse) {
        ctx.rect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.rect(x, y, w, h);
        ctx.clip('evenodd');
      } else {
        ctx.rect(x, y, w, h);
        ctx.clip();
      }
    } else if (clip.drawing) {
      const scaleFactor = Math.pow(2, -(clip.scale - 1));
      const sx = scaleFactor * Xratio;
      const sy = scaleFactor * Yratio;

      const p = new Path2D(clip.drawing.d);

      if (typeof DOMMatrix !== 'undefined') {
        const matrix = new DOMMatrix().scale(sx, sy);
        const transformedPath = new Path2D();
        transformedPath.addPath(p, matrix);

        if (clip.inverse) {
          const finalPath = new Path2D();
          finalPath.rect(0, 0, layer.canvas.width, layer.canvas.height);
          finalPath.addPath(transformedPath);
          ctx.clip(finalPath, 'evenodd');
        } else {
          ctx.clip(transformedPath);
        }
      }
    }
  }

  private getFontHash(font: StyleDescriptor): number {
    return stringHash(JSON.stringify(font));
  }

  private drawWord(word: Word, time: number, startTime: number, layer: Layer, origin?: Vector2) {
    let str = chunkCharToString(word.value);
    this.applyFont(word.font, layer);
    const wordHead = word.value[0] as Char;

    if (wordHead.kind === CHARKIND.DRAWING) {
      this.drawDrawing(wordHead, layer, word.font, origin);
      return;
    }

    if (wordHead.kind === CHARKIND.NORMAL) {
      const ctx = layer.ctx;
      const t = word.font.t;

      // Dialogue-level rotation around rotationOrigin
      if (origin && (t.frz || t.fax || t.fay)) {
        ctx.translate(origin.x, origin.y);
        if (t.frz) ctx.rotate((-t.frz * Math.PI) / 180);
        if (t.fax || t.fay) {
          ctx.transform(1, t.fay || 0, -(t.fax || 0), 1, 0, 0);
        }
        ctx.translate(-origin.x, -origin.y);
      }

      // Glyph-level scaling & 3D tilt around alignment anchor point
      const tiltX = t.fry ? Math.cos((t.fry * Math.PI) / 180) : 1;
      const tiltY = t.frx ? Math.cos((t.frx * Math.PI) / 180) : 1;
      const fscx = (t.fscx / 100) * tiltX;
      const fscy = (t.fscy / 100) * tiltY;

      if (Math.abs(fscx) < 0.001 || Math.abs(fscy) < 0.001) {
        return;
      }

      let anchorX = wordHead.pos.x;
      if (word.font.textAlign === Align.Center) {
        anchorX = wordHead.pos.x + word.w / 2;
      } else if (word.font.textAlign === Align.Right) {
        anchorX = wordHead.pos.x + word.w;
      }

      let anchorY = wordHead.pos.y;
      if (word.font.textBaseline === Baseline.Middle) {
        anchorY = wordHead.pos.y - word.font.fontsize * 0.35;
      } else if (word.font.textBaseline === Baseline.Top) {
        anchorY = wordHead.pos.y - word.font.fontsize * 0.7;
      }

      ctx.translate(anchorX, anchorY);
      ctx.scale(fscx, fscy);
      ctx.translate(-anchorX, -anchorY);

      let hasKaraoke = false;
      let clipWidth = 0;

      if (word.value.some((c) => c.kind === CHARKIND.NORMAL && c.karaoke)) {
        hasKaraoke = true;
        word.value.forEach((char) => {
          if (char.kind === CHARKIND.NORMAL && char.karaoke) {
            const relTime = time - startTime;
            const kStart = char.karaoke.start;
            const kEnd = char.karaoke.end;

            if (relTime >= kEnd) {
              clipWidth += char.w;
            } else if (relTime > kStart) {
              const dur = kEnd - kStart;
              if (dur > 0) {
                const p = (relTime - kStart) / dur;
                if (char.karaoke.type === 'kf' || char.karaoke.type === 'K') {
                  clipWidth += char.w * p;
                } else {
                  clipWidth += char.w;
                }
              }
            }
          } else if (char.kind === CHARKIND.NORMAL) {
            clipWidth += char.w;
          }
        });
      }

      const hasBorder =
        word.font.borderStyle !== 3 && (word.font.xbord !== 0 || word.font.ybord !== 0);

      const avgScale = (Math.abs(fscx) + Math.abs(fscy)) / 2;
      const savedLineWidth = ctx.lineWidth;
      const savedShadowOffsetX = ctx.shadowOffsetX;
      const savedShadowOffsetY = ctx.shadowOffsetY;

      ctx.lineWidth = savedLineWidth / avgScale;
      ctx.shadowOffsetX = savedShadowOffsetX / fscx;
      ctx.shadowOffsetY = savedShadowOffsetY / fscy;

      if (hasBorder) {
        ctx.strokeText(str, wordHead.pos.x, wordHead.pos.y);
        ctx.filter = 'none';
        ctx.shadowColor = 'transparent';
      }

      let metrics = ctx.measureText(str);

      if (hasKaraoke) {
        ctx.save();
        ctx.fillStyle = blendAlpha(word.font.colors.c2, word.font.colors.a2);
        ctx.fillText(str, wordHead.pos.x, wordHead.pos.y);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        const localClipWidth = clipWidth / fscx;
        ctx.rect(
          wordHead.pos.x,
          wordHead.pos.y - layer.canvas.height,
          localClipWidth,
          layer.canvas.height * 2
        );
        ctx.clip();

        ctx.fillText(str, wordHead.pos.x, wordHead.pos.y);
        ctx.restore();
      } else {
        ctx.fillText(str, wordHead.pos.x, wordHead.pos.y);
      }

      if (word.font.underline) {
        const y = wordHead.pos.y + (metrics.emHeightDescent || 2);
        ctx.fillRect(
          wordHead.pos.x,
          y,
          metrics.width,
          (layer.canvas.height * 0.2) / 100 / Math.abs(fscy)
        );
      }
      if (word.font.strikeout) {
        const y =
          wordHead.pos.y - (metrics.hangingBaseline || metrics.actualBoundingBoxAscent || 10) / 2;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillRect(
          wordHead.pos.x,
          y,
          metrics.width,
          (layer.canvas.height * 0.2) / 100 / Math.abs(fscy)
        );
      }

      if (word.font.borderStyle === 3) {
        ctx.save();
        ctx.fillStyle = blendAlpha(word.font.colors.c4, word.font.colors.a4);
        const boxH =
          (metrics.actualBoundingBoxAscent || 20) + (metrics.fontBoundingBoxDescent || 5);
        ctx.fillRect(wordHead.pos.x, wordHead.pos.y - boxH, metrics.width, boxH);
        ctx.restore();
      }
    }
  }

  private drawDrawing(
    char: Extract<Char, { kind: CHARKIND.DRAWING }>,
    layer: Layer,
    font: StyleDescriptor,
    origin?: Vector2
  ) {
    const { pos, path, scale } = char;
    const ctx = layer.ctx;

    ctx.save();

    this.applyTransform(ctx, font, pos, origin, true);

    const pScale = Math.pow(2, -(scale - 1));
    const t = font.t;
    const scaleX = t.fry ? Math.cos((t.fry * Math.PI) / 180) : 1;
    const scaleY = t.frx ? Math.cos((t.frx * Math.PI) / 180) : 1;
    const fscx = (t.fscx / 100) * scaleX;
    const fscy = (t.fscy / 100) * scaleY;

    const Xratio = layer.canvas.width / this.playerResX;
    const Yratio = layer.canvas.height / this.playerResY;

    const sx = fscx * pScale * Xratio;
    const sy = fscy * pScale * Yratio;

    ctx.translate(pos.x, pos.y);

    if (
      typeof DOMMatrix !== 'undefined' &&
      typeof Path2D !== 'undefined' &&
      'addPath' in Path2D.prototype
    ) {
      try {
        const matrix = new DOMMatrix()
          .scale(sx, sy)
          .translate(-char.drawing.minX, -char.drawing.minY);

        const scaledPath = new Path2D();
        scaledPath.addPath(path, matrix);
        const hasBorder = (font.xbord ?? 0) > 0 || (font.ybord ?? 0) > 0;
        if (hasBorder) {
          ctx.stroke(scaledPath);
          ctx.filter = 'none';
          ctx.shadowColor = 'transparent';
        }
        ctx.fill(scaledPath);
      } catch (e) {
        this.fallbackDraw(ctx, path, sx, sy, char.drawing.minX, char.drawing.minY);
      }
    } else {
      this.fallbackDraw(ctx, path, sx, sy, char.drawing.minX, char.drawing.minY);
    }

    ctx.restore();
  }

  private fallbackDraw(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    sx: number,
    sy: number,
    minX = 0,
    minY = 0
  ) {
    ctx.scale(sx, sy);
    ctx.translate(-minX, -minY);
    const hasBorder = ctx.lineWidth > 0;
    if (hasBorder) {
      ctx.stroke(path);
      ctx.filter = 'none';
      ctx.shadowColor = 'transparent';
    }
    ctx.fill(path);
  }

  private applyTransform(
    ctx: CanvasRenderingContext2D,
    font: StyleDescriptor,
    pos: Vector2,
    origin?: Vector2,
    skipScaling = false
  ) {
    const t = font.t;
    const org = origin || pos;

    ctx.translate(org.x, org.y);

    if (t.frz) ctx.rotate((-t.frz * Math.PI) / 180);

    const scaleX = t.fry ? Math.cos((t.fry * Math.PI) / 180) : 1;
    const scaleY = t.frx ? Math.cos((t.frx * Math.PI) / 180) : 1;

    const fscx = (t.fscx / 100) * scaleX;
    const fscy = (t.fscy / 100) * scaleY;

    if (t.fax || t.fay) {
      ctx.transform(1, t.fay || 0, -(t.fax || 0), 1, 0, 0);
    }

    if (!skipScaling) {
      ctx.scale(fscx, fscy);
    }

    ctx.translate(-org.x, -org.y);
  }

  private drawTextBackground(pos: Vector2, height: number, width: number, font: StyleDescriptor) {
    const layer = this.layers[0] as Layer;
    layer.ctx.save();
    layer.ctx.beginPath();
    layer.ctx.fillStyle = blendAlpha(font.colors.c4, font.colors.a4);
    layer.ctx.fillRect(pos.x, pos.y - height, width, height);
    layer.ctx.closePath();
    layer.ctx.restore();
  }

  private clearLayer(_layer?: number) {
    this.layers[0]?.ctx.clearRect(
      0,
      0,
      this.layers[0]?.canvas.width as number,
      this.layers[0]?.canvas.height as number
    );
  }

  clear() {
    this.layers[0]?.ctx.clearRect(
      0,
      0,
      this.layers[0]?.canvas.width as number,
      this.layers[0]?.canvas.height as number
    );
  }

  /**
   * Forces every layer to be painted again on the next frame.
   * Needed after the canvases are resized, since resizing clears their content.
   */
  invalidate() {
    this.lastActiveDialogueHashes.clear();
  }

  private upscaleMargin(margin: Margin) {
    return {
      left: this.upscale(
        margin.left,
        this.playerResX,
        this.layers[0]?.canvas.width || this.playerResX
      ),
      right: this.upscale(
        margin.right,
        this.playerResX,
        this.layers[0]?.canvas.width || this.playerResX
      ),
      vertical: this.upscale(
        margin.vertical,
        this.playerResY,
        this.layers[0]?.canvas.height || this.playerResY
      )
    };
  }

  private applyOverrideTag(tag: CompiledTag, font: StyleDescriptor) {
    if (tag.b !== undefined) {
      font.bold = tag.b === 1 || (tag.b as any) === -1 || (typeof tag.b === 'number' && tag.b > 1);
    }
    if (tag.i !== undefined) font.italic = tag.i === 1 || (tag.i as any) === -1;
    if (tag.u !== undefined) font.underline = tag.u === 1 || (tag.u as any) === -1;
    if (tag.s !== undefined) font.strikeout = tag.s === 1 || (tag.s as any) === -1;
    if (tag.fn !== undefined) font.fontname = tag.fn;
    if (tag.q !== undefined) font.t.q = tag.q;
    if (tag.fs !== undefined) font.fontsize = this.upscaleFontSize(tag.fs, font.fontname);
    if (tag.fscx !== undefined) font.t.fscx = tag.fscx;
    if (tag.fscy !== undefined) font.t.fscy = tag.fscy;
    if (tag.frz !== undefined) font.t.frz = tag.frz;
    if (tag.frx !== undefined) font.t.frx = tag.frx;
    if (tag.fry !== undefined) font.t.fry = tag.fry;
    if (tag.fax !== undefined) font.t.fax = tag.fax;
    if (tag.fay !== undefined) font.t.fay = tag.fay;
    if (tag.fsp !== undefined) {
      font.t.fsp = this.upscale(
        tag.fsp,
        this.playerResX,
        this.layers[0]?.canvas.width || this.playerResX
      );
    }

    if (tag.t !== undefined) font.customAnimations = tag.t;

    if (tag.c1 !== undefined) font.colors.c1 = swapBBGGRR(tag.c1);
    if (tag.c2 !== undefined) font.colors.c2 = swapBBGGRR(tag.c2);
    if (tag.c3 !== undefined) font.colors.c3 = swapBBGGRR(tag.c3);
    if (tag.c4 !== undefined) font.colors.c4 = swapBBGGRR(tag.c4);
    if (tag.a1 !== undefined) font.colors.a1 = parseAlpha(tag.a1);
    if (tag.a2 !== undefined) font.colors.a2 = parseAlpha(tag.a2);
    if (tag.a3 !== undefined) font.colors.a3 = parseAlpha(tag.a3);
    if (tag.a4 !== undefined) font.colors.a4 = parseAlpha(tag.a4);
    if (tag.xshad !== undefined) font.xshad = tag.xshad;
    if (tag.yshad !== undefined) font.yshad = tag.yshad;
    if (tag.xbord !== undefined) font.xbord = tag.xbord;
    if (tag.ybord !== undefined) font.ybord = tag.ybord;
    if (tag.blur !== undefined) font.blur = tag.blur;
    if (tag.be !== undefined) font.be = tag.be;
  }

  private upscale(x: number, firstcomp: number, secondcomp: number) {
    return (ruleOfThree(firstcomp, secondcomp) * x) / 100;
  }

  private fontDecriptorString(font: StyleDescriptor) {
    const weight = font.bold ? 'bold ' : '';
    const style = font.italic ? 'italic ' : '';
    const cleanFontname = font.fontname.trim().replace(/^["']|["']$/g, '');
    const cleanName = cleanFontname
      .replace(/\s+(semibold|bold|regular|light|medium|black|italic)/i, '')
      .trim();
    const fallbacks =
      cleanName.toLowerCase() !== cleanFontname.toLowerCase()
        ? `"${cleanFontname}", "${cleanName}", Arial, sans-serif`
        : `"${cleanFontname}", Arial, sans-serif`;
    return `${style}${weight}${font.fontsize.toFixed(3)}px ${fallbacks}`;
  }

  private computeStyle(name: string, alignment: number, layer: Layer): StyleDescriptor {
    let style = this.styles[name] as CompiledASSStyle | undefined;
    if (style === undefined) {
      // TODO: fallbackFont when there is no style
      // Fallbacks most of the time to Arial
      this.log('WARN', `[ass-html5:renderer] no corresponding style "${name}" found`);
    }

    const defaultStyle: CompiledASSStyle = {
      style: {
        Name: 'Default',
        Fontname: 'Arial',
        Fontsize: 20,
        PrimaryColour: '&H00FFFFFF&',
        SecondaryColour: '&H000000FF&',
        OutlineColour: '&H00000000&',
        BackColour: '&H00000000&',
        Bold: 0,
        Italic: 0,
        Underline: 0,
        StrikeOut: 0,
        ScaleX: 100,
        ScaleY: 100,
        Spacing: 0,
        Angle: 0,
        BorderStyle: 1,
        Outline: 2,
        Shadow: 2,
        Alignment: 2,
        MarginL: 10,
        MarginR: 10,
        MarginV: 10,
        Encoding: 1
      },
      tag: {
        fn: 'Arial',
        fs: 20,
        c1: 'FFFFFF',
        a1: '00',
        c2: '0000FF',
        a2: '00',
        c3: '000000',
        a3: '00',
        c4: '000000',
        a4: '00',
        b: 0,
        i: 0,
        u: 0,
        s: 0,
        fscx: 100,
        fscy: 100,
        fsp: 0,
        frz: 0,
        xbord: 2,
        ybord: 2,
        xshad: 2,
        yshad: 2,
        fe: 1,
        q: 2
      }
    };

    const resolvedStyle: CompiledASSStyle =
      style || this.styles['Default'] || Object.values(this.styles)[0] || defaultStyle;

    const {
      fn, // font name
      fs, // font size
      a1, // primary alpha
      a2, // secondary alpha
      a3, // outline alpha
      c4, // shadow color
      a4, // shadow alpha
      b, // bold
      i, // italic
      u, // underline
      s, // strikeout
      fscx, // font scale x
      fscy, // font scale y
      fsp, // font spacing
      frz, // font rotation z
      xbord, // x border
      ybord, // y border
      xshad, // x shadow
      yshad, // y shadow
      fe, // font encoding
      q // wrap style
    } = resolvedStyle.tag;

    const { PrimaryColour, OutlineColour, SecondaryColour, BackColour, BorderStyle } =
      resolvedStyle.style;

    const isBold = b === 1 || (b as any) === -1 || (typeof b === 'number' && b > 1);
    const isItalic = i === 1 || (i as any) === -1;
    const isUnderline = u === 1 || (u as any) === -1;
    const isStrikeout = s === 1 || (s as any) === -1;

    const font: StyleDescriptor = {
      fontsize: this.upscaleFontSize(fs, fn),
      fontname: fn,
      bold: isBold,
      italic: isItalic,
      underline: isUnderline,
      strikeout: isStrikeout,
      colors: {
        c1: convertAegisubColorToHex(PrimaryColour),
        c2: convertAegisubColorToHex(SecondaryColour),
        c3: convertAegisubColorToHex(OutlineColour),
        c4: c4 ? swapBBGGRR(c4) : BackColour ? convertAegisubColorToHex(BackColour) : '#000000',
        a1: parseAlpha(a1),
        a2: parseAlpha(a2),
        a3: parseAlpha(a3),
        a4: parseAlpha(a4)
      },
      t: {
        fscx: fscx,
        fscy: fscy,
        frz: frz,
        frx: 0,
        fry: 0,
        fsp: this.upscale(fsp, this.playerResX, layer.canvas.width),
        q: q
      },
      customAnimations: [],
      xbord: xbord,
      ybord: ybord,
      xshad: xshad,
      yshad: yshad,
      blur: 0,
      be: 0,
      fe: fe,
      borderStyle: BorderStyle,
      opacity: 1,
      textAlign: this.getAlignment(alignment),
      textBaseline: this.getBaseLine(alignment)
    };

    this.applyFont(font, layer);

    return font;
  }

  private applyFont(font: StyleDescriptor, layer: Layer) {
    layer.ctx.font = this.fontDecriptorString(font);
    layer.ctx.fillStyle = blendAlpha(font.colors.c1, font.colors.a1);
    layer.ctx.strokeStyle = blendAlpha(font.colors.c3, font.colors.a3);
    layer.ctx.letterSpacing = `${font.t.fsp}px`;
    layer.ctx.shadowOffsetX = this.upscale(
      font.xshad,
      this.playerResX,
      this.layers[0]?.canvas.width || this.playerResX
    );
    layer.ctx.shadowOffsetY = this.upscale(
      font.yshad,
      this.playerResY,
      this.layers[0]?.canvas.height || this.playerResY
    );
    layer.ctx.shadowColor = blendAlpha(font.colors.c4, font.colors.a4);
    layer.ctx.lineWidth =
      this.upscale(font.xbord, this.playerResX, this.layers[0]?.canvas.width || this.playerResX) +
      this.upscale(font.ybord, this.playerResY, this.layers[0]?.canvas.height || this.playerResY);
    layer.ctx.lineCap = 'round';
    layer.ctx.lineJoin = 'round';
    layer.ctx.globalAlpha = font.opacity;

    // libass: \blur sigma = blur * scale * 2/sqrt(ln 256) ≈ 0.8493218
    const blurSigma =
      font.blur > 0
        ? this.upscale(
            font.blur,
            this.playerResY,
            this.layers[0]?.canvas.height || this.playerResY
          ) * 0.8493218
        : 0;
    // \be is edge-blur in output pixels, unscaled: sigma ≈ sqrt(N / 2)
    const beSigma = font.be > 0 ? Math.sqrt(font.be / 2) : 0;
    const totalSigma = Math.hypot(blurSigma, beSigma);
    layer.ctx.filter = totalSigma > 0 ? `blur(${totalSigma.toFixed(3)}px)` : 'none';
  }

  private getAlignment(alignment: number) {
    // 1 = (bottom) left
    // 2 = (bottom) center
    // 3 = (bottom) right
    // 4 = (middle) left
    // 5 = (middle) center
    // 6 = (middle) right
    // 7 = (top) left
    // 8 = (top) center
    // 9 = (top) right
    switch (alignment) {
      case 1:
      case 4:
      case 7:
        return Align.Left;
      case 2:
      case 5:
      case 8:
        return Align.Center;
      case 3:
      case 6:
      case 9:
        return Align.Right;
      default:
        return Align.Start;
    }
  }

  private interpolateClip(c1: Clip, c2: Clip, t: number): Clip {
    if (c1.dots && c2.dots) {
      return {
        ...c1,
        dots: {
          x1: lerp(c1.dots.x1, c2.dots.x1, t),
          y1: lerp(c1.dots.y1, c2.dots.y1, t),
          x2: lerp(c1.dots.x2, c2.dots.x2, t),
          y2: lerp(c1.dots.y2, c2.dots.y2, t)
        }
      };
    }
    return c2;
  }

  private getBaseLine(alignment: number) {
    // 1 = (bottom) left
    // 2 = (bottom) center
    // 3 = (bottom) right
    // 4 = (middle) left
    // 5 = (middle) center
    // 6 = (middle) right
    // 7 = (top) left
    // 8 = (top) center
    // 9 = (top) right
    switch (alignment) {
      case 1:
      case 2:
      case 3:
        return Baseline.Bottom;
      case 4:
      case 5:
      case 6:
        return Baseline.Middle;
      case 7:
      case 8:
      case 9:
        return Baseline.Top;
      default:
        return Baseline.Alphabetic;
    }
  }
}
