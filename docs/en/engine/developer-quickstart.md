# Run Your First Game

[한국어](../../engine/developer-quickstart.md) · English

Create a **top-down shooter, run it, and change the character's movement speed**.
To delegate the work, give your agent [AI Game Development](ai-game-development.md).

## 1. Get the installer

Use Node.js 22 and npm. Game projects do not need a separate Rust or wasm-pack installation.
Choose a version from [GitHub Releases](https://github.com/silbaram/ferrum2d/releases) and copy the download URL of
**`ferrum2d-create-game-<version>.tgz`** from its Assets. Follow that release's installation instructions.

These commands use Bash, WSL, or a macOS terminal. In PowerShell, you can put the URL directly into the `npx` command.

```bash
ferrum_cli_url="<create-game .tgz download URL>"
npx --yes --allow-remote=root "$ferrum_cli_url" my-game --template topdown
cd my-game
npm install
```

The `my-game` folder now contains the game's code and settings. `FERRUM_INSTALL.md` records its installation source and reinstall instructions.

## 2. Run the game

```bash
npm run dev
```

Open the local URL printed in the terminal. The current template starts automatically.
If your version shows a title screen, press **Start**.

| Control | Result |
| --- | --- |
| W/A/S/D | Move the character |
| Move the mouse | Aim |
| Left mouse button or Space | Fire |

This template is a small starting game. It may look different from the decorated shooter example on the website.
Press `Ctrl+C` in the terminal to stop the server.

## 3. Change movement speed

Open `my-game/public/game.json` and change `speed` inside `player` to `280`.
This is only the part to edit; keep the rest of the file.

```json
"player": {
  "speed": 280
}
```

Save and refresh the browser. Press **Start** if a title screen appears. Movement should be faster than the template's default `210`.
To check the settings, open another terminal in `my-game` and run:

```bash
npm run ferrum:validate
```

Ask your agent for further gameplay changes, or consult the [Shooter settings reference (Korean)](../../examples/topdown-shooter/game-spec.md).

## 4. Continue with an agent

In a project generated from a GitHub Release, install its agent instructions:

```bash
npm run ferrum:agents
```

Give the agent the project folder and [AI Game Development](ai-game-development.md), then ask:

```text
I changed movement speed to 280.
Check that the change behaves as intended and run the full project checks.
If replay expectations changed, inspect the differences before updating the affected baseline.
Tell me how to run the game and what to check myself.
```

The full check is `npm run ferrum:check`. Gameplay changes can differ from old replay expectations;
the agent should inspect the cause and compare it with the intended change.

## Next steps

| Goal | Action |
| --- | --- |
| Inspect scenes and assets visually | [Studio basics](user-guide.md#edit-and-play-in-studio) |
| Try another genre | Replace `--template topdown` with `platformer`, `breakout`, or `minimal` when generating a project. |
| Check a deployment build | Run `npm run ferrum:deploy-report`, then open the URL from `npm run preview`. |
| Explore features | [Features and Examples](showcase-hub.md) |

`minimal` is also a runnable example. For setup without game code, use [AI Installation (Korean)](../../engine/ai-agent-install.md).

The current source opens the generated project's lightweight Studio with `npm run ferrum:studio`.
Published beta.9 and earlier use `ferrum:placement-viewer`; follow the installed project's `package.json` and instructions.
The standalone Studio app and lightweight project page offer different feature sets.
