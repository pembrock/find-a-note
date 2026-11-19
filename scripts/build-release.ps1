[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    foreach ($command in 'go', 'npm.cmd', 'wails', 'makensis') {
        Get-Command $command -ErrorAction Stop | Out-Null
    }
    $config = Get-Content -Raw wails.json | ConvertFrom-Json
    $version = $config.info.productVersion
    if ($version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw 'Expected X.Y.Z in wails.json info.productVersion.'
    }
    $base = "Find-a-Note-$version-Windows"
    $setup = "$base-Setup.exe"
    $portable = "$base-Portable.exe"
    $exe = "$($config.outputfilename).exe"
    $output = New-Item -ItemType Directory -Force "artifacts/windows-$version"

    Push-Location frontend
    try {
        Invoke-Checked npm.cmd @('ci')
        Invoke-Checked npm.cmd @('run', 'build')
    } finally { Pop-Location }
    & "$PSScriptRoot/write-third-party-notices.ps1"

    $setupSource = Join-Path 'build/bin' $setup
    if (Test-Path -LiteralPath $setupSource) { Remove-Item -LiteralPath $setupSource }
    Invoke-Checked wails @('build', '-platform', 'windows/amd64', '-nsis', '-installscope', 'user',
        '-webview2', 'embed', '-trimpath', '-m', '-nosyncgomod', '-s', '-skipbindings',
        '-ldflags', '-buildid=')

    foreach ($file in $exe, $setup) {
        $metadata = (Get-Item -LiteralPath (Join-Path 'build/bin' $file)).VersionInfo
        $fixedVersion = "$($metadata.ProductMajorPart).$($metadata.ProductMinorPart).$($metadata.ProductBuildPart)"
        if ($metadata.ProductVersion -cne $version -or $metadata.FileVersion -cne $version -or
            $fixedVersion -cne $version -or $metadata.ProductName -cne $config.info.productName) {
            throw "Unexpected version metadata for $file"
        }
    }
    Copy-Item -LiteralPath $setupSource -Destination $output.FullName
    Copy-Item -LiteralPath (Join-Path 'build/bin' $exe) -Destination (Join-Path $output.FullName $portable)
    $checksums = foreach ($file in $setup, $portable) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output.FullName $file)
        "$($hash.Hash.ToLowerInvariant())  $file"
    }
    $checksums | Set-Content -Encoding ascii (Join-Path $output.FullName 'SHA256SUMS.txt')
    Get-ChildItem -LiteralPath $output.FullName
} finally { Pop-Location }
