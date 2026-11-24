'use client';

import { useEffect, useRef } from 'react';
import { GameEngine, type EngineCallbacks } from '@/game/engine';
import type { LevelDef } from '@/game/types';

interface GameCanvasProps {
  level: LevelDef;
  callbacks: EngineCallbacks;
  engineRef: React.RefObject<GameEngine | null>;
}

export function GameCanvas({ level, callbacks, engineRef }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cbRef = useRef(callbacks);
  const levelRef = useRef(level);

  useEffect(() => {
    cbRef.current = callbacks;
    levelRef.current = level;
  }, [callbacks, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, levelRef.current, {
      onSnapshot: (s) => cbRef.current.onSnapshot(s),
      onWin: (r) => cbRef.current.onWin(r),
      onLose: (info) => cbRef.current.onLose(info),
      onSfx: (n, power) => cbRef.current.onSfx(n, power),
    });
    engineRef.current = engine;
    engine.start();

    let raf = 0;
    const resizeSoon = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        engine.resize();
      });
    };
    const observer = new ResizeObserver(resizeSoon);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const onOrientation = () => resizeSoon();
    window.addEventListener('orientationchange', onOrientation);

    return () => {
      window.removeEventListener('orientationchange', onOrientation);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      engine.destroy();
      engineRef.current = null;
    };
  }, [engineRef]);

  return (
    <canvas
      ref={canvasRef}
      className="gd-scene-in block h-full w-full touch-none select-none"
      aria-label="游戏画面"
    />
  );
}
