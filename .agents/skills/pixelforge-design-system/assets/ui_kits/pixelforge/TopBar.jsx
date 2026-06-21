/* global React, Icon */
// Pixelforge — TopBar
// App menu, brand, project title, transport, mode switcher, right tools

function TopBar({ playing, onPlay, onPause, onStop, mode, onMode, onOpenPalette }) {
  return (
    <div className="tb">
      <div className="logo">
        <img src="../../assets/logo.svg" alt=""/>
        <span className="word">PIXELFORGE</span>
      </div>
      <div className="menus">
        {["File","Edit","View","Scene","Project","Debug","Help"].map(m => (
          <span className="m" key={m}>{m}</span>
        ))}
      </div>
      <div className="center">
        <div className="title">
          <span className="dot"/>
          <span>cosmic-jam</span>
          <span style={{color:"var(--fg-3)"}}>/</span>
          <span>level_03.scene</span>
        </div>
      </div>
      <div className="right" style={{display:"flex", alignItems:"center", gap:8}}>
        <div className="play">
          <button className={`run ${playing ? "active" : ""}`} onClick={playing ? onPause : onPlay} title="Run (F5)">
            {playing
              ? <Icon name="pause" size={14}/>
              : <Icon name="play"  size={14}/>}
          </button>
          <button onClick={onStop} title="Stop"><Icon name="stop" size={12}/></button>
        </div>
        <div className="modes">
          {["2D","3D","Script","Asset"].map(m => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => onMode(m)}>{m}</button>
          ))}
        </div>
        <button className="iconbtn" onClick={onOpenPalette} title="Command palette (⌘K)">
          <Icon name="cmd" size={16}/>
        </button>
        <button className="iconbtn"><Icon name="settings" size={16}/></button>
      </div>
    </div>
  );
}

window.TopBar = TopBar;
