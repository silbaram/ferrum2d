/* global React */
function StatusBar({ playing, building, errors, warnings }) {
  return (
    <div className="sb">
      <div className="seg">
        <i style={{background: errors ? "var(--red)" : (building ? "var(--accent)" : "var(--engine-runtime)")}}/>
        {errors ? `${errors} errors` : building ? "Building… 2.4s" : "Ready"}
      </div>
      <div className="seg">main · 12 ahead</div>
      <div className="seg">UTF-8 · LF</div>
      <div className="spacer"/>
      <div className="seg">Ln 42, Col 18</div>
      <div className="seg">GDScript</div>
      <div className="seg accent">FPS 60 · DRAW 124 · MEM 86MB</div>
    </div>
  );
}
window.StatusBar = StatusBar;
