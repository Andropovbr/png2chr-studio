$ErrorActionPreference = "Stop"

$demoDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDirectory = Join-Path $demoDirectory "build"

$requiredFiles = @(
    "random-playfield.chr",
    "random-playfield.nam",
    "random-playfield.atr",
    "random-playfield.col"
)

foreach ($requiredFile in $requiredFiles) {
    $requiredPath = Join-Path $demoDirectory $requiredFile
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Arquivo necessário não encontrado: $requiredPath"
    }
}

New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

Push-Location $demoDirectory
try {
    ca65 main.s -g -o build\main.o
    if ($LASTEXITCODE -ne 0) { throw "ca65 falhou com código $LASTEXITCODE" }

    ld65 -C nrom.cfg build\main.o -o playfield-demo.nes -m build\playfield-demo.map --dbgfile build\playfield-demo.dbg
    if ($LASTEXITCODE -ne 0) { throw "ld65 falhou com código $LASTEXITCODE" }
}
finally {
    Pop-Location
}

$romPath = Join-Path $demoDirectory "playfield-demo.nes"
Write-Host "ROM gerada: $romPath"
