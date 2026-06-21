/* global React, Icon */
// Pixelforge — Inspector
// Property panel for the selected node.

function Section({ title, children, open = true, onToggle }) {
  return (
    <div className="section">
      <div className="section-h" onClick={onToggle}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        {title}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

function Row({ k, children, single }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <div className={`v ${single ? "single" : ""}`}>{children}</div>
    </div>
  );
}

function Vec2({ x, y }) {
  return (
    <>
      <span className="num"><span className="axis x">x</span>{x.toFixed(1)}</span>
      <span className="num"><span className="axis y">y</span>{y.toFixed(1)}</span>
    </>
  );
}

function Inspector({ node }) {
  if (!node) {
    return (
      <div className="panel">
        <div className="panel-head"><span className="title">Inspector</span></div>
        <div className="panel-body" style={{padding:18, color:"var(--fg-3)", fontSize:12}}>
          Nothing selected. Pick a node in the scene tree.
        </div>
      </div>
    );
  }
  return (
    <div className="panel insp">
      <div className="panel-head">
        <span className="title">Inspector</span>
        <span className="spacer"/>
        <button className="iconbtn"><Icon name="more" size={14}/></button>
      </div>
      <div className="panel-body">
        <div className="header">
          <img className="ico" src={`../../assets/node-icons/${(node.iconKey || "node2d")}.svg`} style={{filter:"invert(75%) sepia(50%) saturate(700%) hue-rotate(355deg)"}} alt=""/>
          <div>
            <div className="name">{node.name}</div>
            <div className="type">{node.type}</div>
          </div>
        </div>

        <Section title="Transform">
          <Row k="Position"><Vec2 x={node.position.x} y={node.position.y}/></Row>
          <Row k="Scale"><Vec2 x={node.scale.x} y={node.scale.y}/></Row>
          <Row k="Rotation" single>
            <span className="num"><span className="axis" style={{color:"var(--fg-3)"}}>θ</span>{node.rotation.toFixed(2)}°</span>
          </Row>
        </Section>

        <Section title="Visual">
          <Row k="Visible" single><span className="switch"/></Row>
          <Row k="Modulate" single><div className="swatch" style={{background:"var(--accent)"}}/></Row>
          <Row k="Z-index" single>
            <span className="num">{node.z}</span>
          </Row>
        </Section>

        <Section title="Texture">
          <Row k="Source" single>
            <span className="num" style={{color:"var(--accent)"}}>hero.png</span>
          </Row>
          <Row k="Region"><Vec2 x={0} y={0}/></Row>
          <Row k="Filter" single><span className="switch off"/></Row>
        </Section>

        <Section title="Physics" open={false}/>
        <Section title="Script"   open={false}/>
      </div>
    </div>
  );
}

window.Inspector = Inspector;
window.InspSection = Section;
