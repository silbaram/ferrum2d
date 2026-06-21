/* global React, Icon */
// Pixelforge — Command palette overlay (⌘K)

const COMMANDS = [
  { id:"run",    label: "Run Project",          icon:"play",   meta:"F5" },
  { id:"stop",   label: "Stop Project",         icon:"stop",   meta:"⇧F5" },
  { id:"save",   label: "Save Scene",           icon:"file",   meta:"⌘S" },
  { id:"newnode",label: "Add Child Node…",      icon:"plus",   meta:"⌘A" },
  { id:"open",   label: "Open File…",           icon:"files",  meta:"⌘O" },
  { id:"search", label: "Search in Project…",   icon:"search", meta:"⌘⇧F" },
  { id:"theme",  label: "Toggle Theme",         icon:"settings" },
  { id:"export", label: "Export Build…",        icon:"chev" },
];

function CommandPalette({ onClose }) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const filtered = COMMANDS.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));

  React.useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(filtered.length - 1, s + 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
      if (e.key === "Enter")     { onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered.length, onClose]);

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="input">
          <Icon name="search" size={16} stroke={1.5}/>
          <input
            autoFocus
            placeholder="Type a command, file, or symbol…"
            value={q}
            onChange={e => { setQ(e.target.value); setSel(0); }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="results">
          {filtered.map((c, i) => (
            <div key={c.id} className={`res ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)}>
              <span className="ico"><Icon name={c.icon} size={14} stroke={1.5}/></span>
              <span>{c.label}</span>
              {c.meta && <span className="meta">{c.meta}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{padding:"18px 16px", color:"var(--fg-3)", fontSize:13}}>No results.</div>
          )}
        </div>
      </div>
    </div>
  );
}
window.CommandPalette = CommandPalette;
