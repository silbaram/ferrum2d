/* global React, Icon */
// Pixelforge — SceneTree
// Hierarchical scene panel. `nodes` is a flat list with depth.
// Uses custom 8x8 pixel-grid node icons under ../../assets/node-icons/

const NODE_ICONS = {
  Node2D:    "node2d",
  Sprite:    "sprite",
  RigidBody: "rigidbody",
  Collider:  "collider",
  Animation: "animation",
  Camera:    "camera",
  TileMap:   "tilemap",
  Script:    "script",
  Audio:     "audio",
  Particles: "particles",
};
const TINTS = {
  Node2D:"ti-node", Sprite:"ti-sprite", RigidBody:"ti-body", Collider:"ti-coll",
  Animation:"ti-anim", Camera:"ti-cam", TileMap:"ti-tile",
  Script:"ti-script", Audio:"ti-audio", Particles:"ti-part",
};

function SceneTree({ nodes, selected, onSelect, onAdd }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">Scene</span>
        <span className="spacer"/>
        <button className="iconbtn" onClick={onAdd} title="Add child node (⌘A)">
          <Icon name="plus" size={14}/>
        </button>
        <button className="iconbtn"><Icon name="more" size={14}/></button>
      </div>
      <div className="panel-body">
        <div className="tree">
          {nodes.map(n => (
            <div
              key={n.id}
              className={`row ${selected === n.id ? "sel" : ""}`}
              style={{paddingLeft: 4 + n.depth * 14}}
              onClick={() => onSelect(n.id)}
            >
              <span className="chev">{n.children ? (n.open ? "▾" : "▸") : "·"}</span>
              <img
                className={`ico ${TINTS[n.type] || ""}`}
                src={`../../assets/node-icons/${NODE_ICONS[n.type] || "node2d"}.svg`}
                alt=""
              />
              <span className="name">{n.name}</span>
              <span className="meta">{n.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.SceneTree = SceneTree;
