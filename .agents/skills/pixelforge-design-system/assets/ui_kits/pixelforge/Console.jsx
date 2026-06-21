/* global React, Icon */
// Pixelforge — Console / bottom dock

function Console({ active, onChange, logs }) {
  const tabs = [
    { id: "output",   label: "Output",    icon: "terminal" },
    { id: "debugger", label: "Debugger",  icon: "bug",      count: 3, kind: "err" },
    { id: "animation",label: "Animation", icon: "play" },
    { id: "audio",    label: "Audio",     icon: "music" },
  ];
  return (
    <div className="panel">
      <div className="console-tabs">
        {tabs.map(t => (
          <div key={t.id}
               className={`tab ${active === t.id ? "active" : ""}`}
               onClick={() => onChange(t.id)}>
            <Icon name={t.icon} size={12} stroke={1.5}/>
            <span>{t.label}</span>
            {t.count != null && (
              <span className="pip"
                    style={{ background: t.kind === "err" ? "rgba(255,107,107,.15)" : "var(--bg-3)",
                             color: t.kind === "err" ? "var(--red)" : "var(--fg-2)" }}>
                {t.count}
              </span>
            )}
          </div>
        ))}
        <span className="spacer"/>
        <div className="right">
          <button title="Filter"><Icon name="search" size={14}/></button>
          <button title="Clear"><Icon name="trash"  size={14}/></button>
          <button title="More"><Icon name="more"   size={14}/></button>
        </div>
      </div>
      <div className="console-body">
        {logs.map((l, i) => (
          <div key={i} className={`console-line ${l.level}`}>
            <span className="ts">{l.ts}</span>
            <span className="lvl">{l.level.toUpperCase()}</span>
            <span className="msg" dangerouslySetInnerHTML={{ __html: l.html || l.msg }}/>
          </div>
        ))}
      </div>
    </div>
  );
}
window.Console = Console;
