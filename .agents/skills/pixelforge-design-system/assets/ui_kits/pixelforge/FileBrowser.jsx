/* global React, Icon */
// Pixelforge — File Browser

function FileBrowser({ files, selected, onSelect }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Files</span>
        <span className="spacer"/>
        <button className="iconbtn"><Icon name="plus" size={14}/></button>
        <button className="iconbtn"><Icon name="more" size={14}/></button>
      </div>
      <div className="panel-body">
        <div className="fb">
          {files.map(f => (
            <div
              key={f.id}
              className={`row ${selected === f.id ? "sel" : ""}`}
              style={{paddingLeft: 4 + f.depth * 14}}
              onClick={() => onSelect(f.id)}
            >
              <span className="chev">{f.kind === "dir" ? (f.open ? "▾" : "▸") : ""}</span>
              <span className="ico">
                <Icon name={f.kind === "dir" ? "folder" : "file"} size={12} stroke={1.5}/>
              </span>
              <span className="name">{f.name}</span>
              <span className="ext">{f.ext || ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.FileBrowser = FileBrowser;
