# OScribe Unity Bridge Plugin

Plugin BepInEx pour exposer le scene tree Unity a OScribe via TCP.
Fonctionne avec n'importe quel jeu Unity Mono.

## Compatibilite

| Runtime | BepInEx | Status |
|---------|---------|--------|
| Unity Mono | BepInEx 5.x | OK |
| Unity IL2CPP | BepInEx 6.x | Non teste |

**Versions Lite** (par defaut) : pas de dependance TMPro ni Newtonsoft.Json.
**Versions Full** : supportent TMPro + Newtonsoft.Json (pour jeux qui les incluent).

## Installation pour un nouveau jeu

### 1. Identifier le runtime Unity

```bash
# Si le dossier du jeu contient MonoBleedingEdge/ → Mono
# Si le dossier contient GameAssembly.dll → IL2CPP
```

### 2. Installer BepInEx 5

Telecharger depuis https://github.com/BepInEx/BepInEx/releases

- **Windows x64** : `BepInEx_win_x64_5.4.23.2.zip`
- **Windows x86** : `BepInEx_win_x86_5.4.23.2.zip`
- **Linux** : `BepInEx_linux_x64_5.4.23.2.zip`

Extraire dans le dossier du jeu (a cote de l'exe principal).

### 3. Premier lancement

Lancer le jeu une fois pour que BepInEx initialise ses dossiers :
```
<jeu>/
  BepInEx/
    core/
    plugins/     ← ici
    config/
    patchers/
```

### 4. Adapter le .csproj

Copier `OScribeBridge.csproj` et modifier les chemins des DLLs :

```xml
<!-- Pointer vers les DLLs du jeu cible -->
<Reference Include="UnityEngine">
  <HintPath>C:\chemin\vers\jeu\JeuData\Managed\UnityEngine.dll</HintPath>
</Reference>
<Reference Include="BepInEx">
  <HintPath>C:\chemin\vers\jeu\BepInEx\core\BepInEx.dll</HintPath>
</Reference>
```

**DLLs requises** (dans `<Jeu>_Data/Managed/`) :
- `UnityEngine.dll`
- `UnityEngine.CoreModule.dll`
- `UnityEngine.UI.dll`
- `UnityEngine.UIModule.dll`
- `UnityEngine.PhysicsModule.dll`
- `UnityEngine.Physics2DModule.dll`

**DLLs optionnelles** (si presentes, utiliser les versions Full) :
- `Unity.TextMeshPro.dll` → activer `SceneTreeWalker.cs` au lieu de `SceneTreeWalkerLite.cs`
- `Newtonsoft.Json.dll` → activer `TcpServer.cs` au lieu de `TcpServerLite.cs`

### 5. Choisir les fichiers a compiler

Dans le `.csproj`, section `<ItemGroup>` :

**Sans TMPro/Newtonsoft (Lite)** :
```xml
<Compile Include="Protocol.cs" />
<Compile Include="OScribeBridge.cs" />
<Compile Include="SceneTreeWalkerLite.cs" />
<Compile Include="TcpServerLite.cs" />
```

**Avec TMPro + Newtonsoft (Full)** :
```xml
<Compile Include="Protocol.cs" />
<Compile Include="OScribeBridge.cs" />
<Compile Include="SceneTreeWalker.cs" />
<Compile Include="TcpServer.cs" />
<Compile Include="UIElementDetector.cs" />
```

### 6. Build et deploy

```bash
cd oscribe/plugins/unity-bridge
dotnet build -c Release
```

Copier `bin/Release/net472/OScribeBridge.dll` dans `<jeu>/BepInEx/plugins/`.

**Important** : le DLL est verrouille pendant que le jeu tourne. Fermer le jeu avant de remplacer.

## Protocole TCP

**Port:** `localhost:9876`

**Framing:** Length-prefix (gere les payloads >64kb)
```
[4 bytes: length (big-endian)] + [JSON payload]
```

**Response JSON:**
```json
{
  "version": "1.0",
  "gameInfo": {
    "name": "Helltaker",
    "scene": "mainMenu",
    "resolution": { "width": 1176, "height": 664 }
  },
  "elements": [
    {
      "type": "Button",
      "name": "PlayButton",
      "path": "Canvas/MainMenu/PlayButton",
      "screenRect": { "x": 860.0, "y": 440.0, "width": 200.0, "height": 60.0 },
      "isInteractable": true,
      "isVisible": true,
      "value": "Play",
      "automationId": null,
      "is3D": false
    }
  ],
  "timestamp": "2026-02-05T19:26:14.991Z"
}
```

## Elements detectes

### Canvas UI
- Button, Toggle, Slider, InputField, Dropdown
- Text (+ TMP_Text en version Full)
- Image (si raycastTarget=true)

### GameObjects 3D
- **Lite** : tout objet avec Collider (non filtre)
- **Full** : filtre par tag "Interactable"/"Card", layer "Interactive", ou handlers IPointer*

## Test manuel

```powershell
# PowerShell - connexion TCP directe
$client = New-Object System.Net.Sockets.TcpClient("localhost", 9876)
$stream = $client.GetStream()
$stream.ReadTimeout = 5000

# Lire le length-prefix (4 bytes big-endian)
$buf = New-Object byte[] 4
$stream.Read($buf, 0, 4)
[Array]::Reverse($buf)
$len = [BitConverter]::ToInt32($buf, 0)

# Lire le payload JSON
$payload = New-Object byte[] $len
$total = 0
while ($total -lt $len) {
    $r = $stream.Read($payload, $total, $len - $total)
    $total += $r
}
$json = [System.Text.Encoding]::UTF8.GetString($payload)
Write-Host $json

$client.Close()
```

## Debugging

Logs dans la console BepInEx (`BepInEx/LogOutput.log`) :
```
[Info   : OScribe] OScribe Bridge started on port 9876
```

## Jeux testes

| Jeu | Unity | Runtime | Elements | Status |
|-----|-------|---------|----------|--------|
| Helltaker | 2019.2.9 | Mono | 88 | OK (Lite) |

## Gotchas

- **Locale francaise** : les floats doivent utiliser `CultureInfo.InvariantCulture` sinon les virgules cassent le JSON
- **DLL lock** : fermer le jeu avant de remplacer le plugin
- **Main thread** : les API Unity ne fonctionnent que sur le main thread, d'ou le pattern `ConcurrentQueue` + `Update()`
- **`{3:F1}}}` bug** : ne pas utiliser `AppendFormat` avec `{{`/`}}` pour des floats, utiliser `ToString("F1", inv)` + `Append()`
