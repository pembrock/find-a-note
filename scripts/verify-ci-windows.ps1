[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PackageDirectory
)

$ErrorActionPreference = 'Stop'

function Read-PEMachine([string]$Path) {
    $reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($Path))
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Missing MZ signature in $Path" }
        $reader.BaseStream.Position = 0x3C
        $reader.BaseStream.Position = $reader.ReadUInt32()
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Missing PE signature in $Path" }
        return $reader.ReadUInt16()
    } finally {
        $reader.Dispose()
    }
}

$config = Get-Content -Raw wails.json | ConvertFrom-Json
$version = $config.info.productVersion
$base = "Find-a-Note-$version-Windows"
$packages = (Resolve-Path -LiteralPath $PackageDirectory).Path
$portable = Join-Path $packages "$base-Portable.exe"
$setup = Join-Path $packages "$base-Setup.exe"

if ((Read-PEMachine $portable) -ne 0x8664) { throw 'Portable must be a Windows amd64 executable.' }
if ((Read-PEMachine $setup) -ne 0x014c) { throw 'Expected the standard x86 NSIS bootstrapper.' }

# Extract the embedded application through the same isolated stage mode used by
# the updater. This branch does not touch the registry or install shortcuts.
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "find-a-note-ci-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    New-Item -ItemType File -Path "$stage/.find-a-note-stage" | Out-Null
    $process = Start-Process -FilePath $setup -ArgumentList "/S /UPDATESTAGE /D=$stage" -PassThru
    try {
        if (!$process.WaitForExit(120000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'NSIS staging timed out.'
        }
        if ($process.ExitCode -ne 0) { throw "NSIS staging failed with exit code $($process.ExitCode)." }
    } finally {
        $process.Dispose()
    }

    $payload = Join-Path $stage "$($config.outputfilename).exe"
    if ((Read-PEMachine $payload) -ne 0x8664) { throw 'Setup must contain the amd64 application.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $payload).Hash -cne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $portable).Hash) {
        throw 'The staged installer application differs from Portable.'
    }
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
