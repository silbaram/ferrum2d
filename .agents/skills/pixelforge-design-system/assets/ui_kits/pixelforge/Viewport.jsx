/* global React, Icon */
// Pixelforge — Viewport
// 2D canvas with checkerboard, ground, sky, sprites positioned in CSS.
// HUD chips top-left, tool dock bottom-left, zoom bottom-right.

function Viewport({ tool, onTool, zoom, onZoom, playing, sprites, selected, onSelect }) {
  return (
    <div className="viewport-wrap">
      <div className="viewport-ruler-x"/>
      <div className="viewport-ruler-y"/>
      <div className="viewport-stage">
        <div className="viewport-canvas">
          <div className="sky"/>
          <div className="grass-top"/>
          <div className="ground"/>
          {sprites.map(s => (
            <img
              key={s.id}
              className="sprite"
              src={s.src}
              style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
              onClick={() => onSelect(s.id)}
              alt=""
            />
          ))}
          {selected && (() => {
            const s = sprites.find(x => x.id === selected);
            if (!s) return null;
            return (
              <div className="selected-frame" style={{ left: s.x-1, top: s.y-1, width: s.w+2, height: s.h+2 }}>
                <span className="h tl"/><span className="h tr"/>
                <span className="h bl"/><span className="h br"/>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="viewport-hud">
        <span className="chip"><span className="accent">●</span> {playing ? "RUNNING" : "EDIT"}</span>
        <span className="chip">FPS <span className="accent">60</span></span>
        <span className="chip">DRAW <span className="accent">124</span></span>
        <span className="chip">{zoom}%</span>
      </div>

      <div className="viewport-tools">
        <button className={tool === "select" ? "active" : ""} onClick={() => onTool("select")} title="Select (V)"><Icon name="cursor" size={14}/></button>
        <button className={tool === "move"   ? "active" : ""} onClick={() => onTool("move")}   title="Move (M)"><Icon name="move"   size={14}/></button>
        <button className={tool === "rotate" ? "active" : ""} onClick={() => onTool("rotate")} title="Rotate (R)"><Icon name="rotate" size={14}/></button>
        <button className={tool === "scale"  ? "active" : ""} onClick={() => onTool("scale")}  title="Scale (S)"><Icon name="scale"  size={14}/></button>
        <span className="sep"/>
        <button title="Grid"><Icon name="grid" size={14}/></button>
        <button className="active" title="Snap"><Icon name="snap" size={14}/></button>
      </div>

      <div className="viewport-zoom">
        <button onClick={() => onZoom(Math.max(25, zoom - 25))}>−</button>
        <span>{zoom}%</span>
        <button onClick={() => onZoom(Math.min(400, zoom + 25))}>+</button>
      </div>
    </div>
  );
}
window.Viewport = Viewport;
