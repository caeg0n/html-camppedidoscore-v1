param(
  [Parameter(Mandatory = $true)][string]$IndexPath,
  [Parameter(Mandatory = $true)][string]$VersionValue
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $IndexPath)) {
  throw "INDEX_NOT_FOUND"
}

$raw = Get-Content -LiteralPath $IndexPath -Raw
$updated = [regex]::Replace(
  $raw,
  '(<span id="build-version">)[^<]*(</span>)',
  ('$1' + $VersionValue + '$2')
)

if ($updated -eq $raw) {
  throw "BUILD_VERSION_SPAN_NOT_FOUND"
}

Set-Content -LiteralPath $IndexPath -Value $updated -Encoding utf8
