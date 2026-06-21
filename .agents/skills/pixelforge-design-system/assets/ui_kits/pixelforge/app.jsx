/* global React, TopBar, ActivityBar, SceneTree, FileBrowser, Tabs, Viewport, Inspector, Console, StatusBar, CommandPalette */

const { useState } = React;

const INITIAL_NODES = [
  { id: "world",  name: "World",      type: "Node2D",    depth: 0, children: true, open: true },
  { id: "bg",     name: "Background", type: "TileMap",   depth: 1, children: false },
  { id: "player", name: "Player",     type: "Sprite",    depth: 1, children: true, open: true },
  { id: "body",   name: "Body",       type: "Collider",  depth: 2, children: false },
  { id: "anim",   name: "Anim",       type: "Animation", depth: 2, children: false },
  { id: "script", name: "player.gd",  type: "Script",    depth: 2, children: false },
  { id: "coin",   name: "Coin",       type: "Sprite",    depth: 1, children: false },
  { id: "cam",    name: "MainCamera", type: "Camera",    depth: 1, children: false },
  { id: "music",  name: "Music",      type: "Audio",     depth: 1, children: false },
  { id: "fx",     name: "Dust",       type: "Particles", depth: 1, children: false },
];

const FILES = [
  { id:"d-scenes", name:"scenes",      kind:"dir", depth:0, open:true },
  { id:"f-l1",    name:"level_01",     kind:"file",ext:".scene", depth:1 },
  { id:"f-l2",    name:"level_02",     kind:"file",ext:".scene", depth:1 },
  { id:"f-l3",    name:"level_03",     kind:"file",ext:".scene", depth:1 },
  { id:"d-scripts",name:"scripts",     kind:"dir", depth:0, open:true },
  { id:"f-main",   name:"main",        kind:"file",ext:".gd",    depth:1 },
  { id:"f-player", name:"player",      kind:"file",ext:".gd",    depth:1 },
  { id:"f-enemy",  name:"enemy",       kind:"file",ext:".gd",    depth:1 },
  { id:"d-sprites",name:"sprites",     kind:"dir", depth:0, open:true },
  { id:"f-hero",   name:"hero",        kind:"file",ext:".png",   depth:1 },
  { id:"f-coin",   name:"coin",        kind:"file",ext:".png",   depth:1 },
  { id:"f-tiles",  name:"tiles",       kind:"file",ext:".png",   depth:1 },
  { id:"d-audio",  name:"audio",       kind:"dir", depth:0 },
  { id:"f-jump",   name:"jump",        kind:"file",ext:".wav",   depth:1 },
];

const TABS = [
  { id:"t-main",   kind:"script", name:"main.gd",        dirty:false },
  { id:"t-player", kind:"script", name:"player.gd",      dirty:true  },
  { id:"t-l3",     kind:"scene",  name:"level_03.scene", dirty:false },
];

const INITIAL_SPRITES = [
  { id:"player", src:"../../assets/sample-sprites/hero.png", x: 180, y: 130, w: 32, h: 32 },
  { id:"coin",   src:"../../assets/sample-sprites/coin.png", x: 320, y: 150, w: 16, h: 16 },
  { id:"coin2",  src:"../../assets/sample-sprites/coin.png", x: 360, y: 160, w: 16, h: 16 },
  { id:"coin3",  src:"../../assets/sample-sprites/coin.png", x: 400, y: 150, w: 16, h: 16 },
];

const NODE_DETAILS = {
  player: {
    name: "Player", type: "Sprite", iconKey: "sprite",
    position: {x: 128.0, y: 64.5}, scale: {x: 1.0, y: 1.0},
    rotation: 0.00, z: 1,
  },
  coin: {
    name: "Coin", type: "Sprite", iconKey: "sprite",
    position: {x: 320.0, y: 150.0}, scale: {x: 1.0, y: 1.0},
    rotation: 0.00, z: 0,
  },
  bg: {
    name: "Background", type: "TileMap", iconKey: "tilemap",
    position: {x: 0, y: 0}, scale: {x: 1.0, y: 1.0}, rotation: 0, z: -5,
  },
};

const INITIAL_LOGS = [
  { ts:"00:00:12", level:"info", html:'Project <span style="color:var(--fg-1)">cosmic-jam</span> opened.' },
  { ts:"00:00:14", level:"info", html:'Loaded 14 assets · 8 scripts · 3 scenes.' },
  { ts:"00:00:18", level:"warn", html:'Asset <span class="file">hero.png</span> is not pixel-aligned (size 33×32).' },
  { ts:"00:00:22", level:"err",  html:'<span class="file">player.gd:42</span> Cannot find member <span style="color:var(--code-string)">"jump_speed"</span> on type Sprite.' },
  { ts:"00:00:22", level:"err",  html:'<span class="file">player.gd:58</span> Unexpected token <span style="color:var(--code-string)">"="</span>.' },
  { ts:"00:00:22", level:"err",  html:'<span class="file">enemy.gd:14</span> Function <span style="color:var(--code-function)">_physics_process</span> is missing argument <span style="color:var(--code-type)">delta</span>.' },
  { ts:"00:00:23", level:"info", html:'Build started…' },
  { ts:"00:00:25", level:"ok",   html:'Build finished in 2.4s · 0 errors after fix.' },
];

function App() {
  const [active, setActive]       = useState("scene");
  const [selectedNode, setSel]    = useState("player");
  const [selectedFile, setSelF]   = useState("f-player");
  const [activeTab, setActiveTab] = useState("t-l3");
  const [openTabs, setOpenTabs]   = useState(TABS);
  const [tool, setTool]           = useState("select");
  const [zoom, setZoom]           = useState(140);
  const [mode, setMode]           = useState("2D");
  const [playing, setPlaying]     = useState(false);
  const [consoleTab, setConsoleTab] = useState("debugger");
  const [paletteOpen, setPalette] = useState(false);
  const [spriteSel, setSpriteSel] = useState("player");

  // ⌘K opens the palette
  React.useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPalette(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const node = NODE_DETAILS[selectedNode] || NODE_DETAILS.player;

  return (
    <div className="pf-app pf-grain">
      <TopBar
        playing={playing}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onStop={() => setPlaying(false)}
        mode={mode} onMode={setMode}
        onOpenPalette={() => setPalette(true)}
      />
      <div className="pf-main">
        <div className="pf-activity">
          <ActivityBar active={active} onChange={setActive}/>
        </div>
        <div className="pf-left-top">
          <SceneTree
            nodes={INITIAL_NODES}
            selected={selectedNode}
            onSelect={setSel}
            onAdd={() => {}}
          />
        </div>
        <div className="pf-left-bot">
          <FileBrowser
            files={FILES}
            selected={selectedFile}
            onSelect={setSelF}
          />
        </div>
        <div className="pf-center">
          <Tabs
            tabs={openTabs}
            active={activeTab}
            onActivate={setActiveTab}
            onClose={(id) => setOpenTabs(openTabs.filter(t => t.id !== id))}
          />
          <Viewport
            tool={tool} onTool={setTool}
            zoom={zoom} onZoom={setZoom}
            playing={playing}
            sprites={INITIAL_SPRITES}
            selected={spriteSel}
            onSelect={(id) => {
              setSpriteSel(id);
              if (id === "player") setSel("player");
              else if (id.startsWith("coin")) setSel("coin");
            }}
          />
        </div>
        <div className="pf-right">
          <Inspector node={node}/>
        </div>
        <div className="pf-bottom">
          <Console active={consoleTab} onChange={setConsoleTab} logs={INITIAL_LOGS}/>
        </div>
      </div>
      <StatusBar playing={playing} errors={3}/>
      {paletteOpen && <CommandPalette onClose={() => setPalette(false)}/>}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App/>);
