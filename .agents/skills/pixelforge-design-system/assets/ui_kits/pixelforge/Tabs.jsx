/* global React, Icon */
// Pixelforge — Editor tab strip

const TAB_ICONS = {
  script: "script", scene: "sprite", image: "sprite", audio: "audio",
};

function Tabs({ tabs, active, onActivate, onClose }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <div
          key={t.id}
          className={`tab ${active === t.id ? "active" : ""}`}
          onClick={() => onActivate(t.id)}
        >
          <img className="ico ti-script"
               src={`../../assets/node-icons/${TAB_ICONS[t.kind] || "script"}.svg`}
               alt=""/>
          <span>{t.name}</span>
          {t.dirty && <span className="dot"/>}
          <span className="x" onClick={e => { e.stopPropagation(); onClose(t.id); }}>×</span>
        </div>
      ))}
    </div>
  );
}
window.Tabs = Tabs;
