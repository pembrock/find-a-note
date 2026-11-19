$ErrorActionPreference = 'Stop'
$notice = Join-Path $PWD 'frontend/dist/THIRD-PARTY-NOTICES.txt'
$licenseName = '^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE|UNLICENSE|PATENTS)([._-].*)?$'

function Read-Notices([string]$Label, [string]$Directory, [string]$Fallback) {
    $files = @(Get-ChildItem -LiteralPath $Directory -File | Where-Object Name -Match $licenseName | Sort-Object Name)
    if ($files.Count -eq 0 -and $Fallback -and (Test-Path -LiteralPath $Fallback)) {
        $files = @(Get-Item -LiteralPath $Fallback)
    }
    if ($files.Count -eq 0) { throw "Missing license text for $Label" }
    foreach ($file in $files) {
        "=== $Label | $($file.Name) ==="
        Get-Content -Raw -LiteralPath $file.FullName
    }
}

$format = '{{with .Module}}{{if not .Main}}{{.Path}}@{{.Version}}|{{.Dir}}{{end}}{{end}}'
$previousEnvironment = @{}
foreach ($name in 'GOOS', 'GOARCH', 'CGO_ENABLED') {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}
try {
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    $modules = @(go list -deps -tags 'desktop,production,wv2runtime.embed' -f $format .)
    if ($LASTEXITCODE -ne 0) { throw 'go list failed' }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name])
    }
}
$goRoot = go env GOROOT
if ($LASTEXITCODE -ne 0) { throw 'go env failed' }

Push-Location frontend
try {
    $frontendRoot = $PWD.Path
    $packages = @(npm.cmd ls --omit=dev --all --parseable)
    if ($LASTEXITCODE -ne 0) { throw 'npm ls failed' }
    # Vite injects its modulepreload polyfill into the bundled runtime.
    $packages += Join-Path $frontendRoot 'node_modules/vite'
} finally { Pop-Location }

$notices = @(
    'Find a Note | Third-party notices'
    'Salamander Grand Piano attribution and CC BY 3.0: audio/salamander/ATTRIBUTION.txt and LICENSE.txt'
    ''
    Read-Notices 'Go standard library' $goRoot
    foreach ($module in ($modules | Where-Object { $_ } | Sort-Object -Unique)) {
        $label, $directory = $module -split '\|', 2
        Read-Notices $label $directory
    }
    foreach ($directory in ($packages | Where-Object { $_ -and $_ -ne $frontendRoot } | Sort-Object -Unique)) {
        $package = Get-Content -Raw -LiteralPath (Join-Path $directory 'package.json') | ConvertFrom-Json
        $fallback = Join-Path 'licenses' "$($package.name)-$($package.version).LICENSE.txt"
        Read-Notices "$($package.name)@$($package.version)" $directory $fallback
    }
)
$notices | Set-Content -Encoding UTF8 -LiteralPath $notice
