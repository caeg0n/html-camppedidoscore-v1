param(
  [Parameter(Mandatory = $true)][string]$IndexPath,
  [Parameter(Mandatory = $true)][string]$VersionValue,
  [Parameter(Mandatory = $false)][string]$CacheToken = ""
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

if (-not [string]::IsNullOrWhiteSpace($CacheToken)) {
  $updated = [regex]::Replace(
    $updated,
    '(<script\s+src="js/firebase-config\.js)(\?v=[^"]*)?("></script>)',
    ('$1?v=' + $CacheToken + '$3')
  )
  $updated = [regex]::Replace(
    $updated,
    '(<script\s+src="js/firebase-votes\.js)(\?v=[^"]*)?("></script>)',
    ('$1?v=' + $CacheToken + '$3')
  )
  $updated = [regex]::Replace(
    $updated,
    '(<script\s+src="js/script\.js)(\?v=[^"]*)?("></script>)',
    ('$1?v=' + $CacheToken + '$3')
  )
}

if ($updated -eq $raw) {
  throw "BUILD_VERSION_SPAN_NOT_FOUND"
}

Set-Content -LiteralPath $IndexPath -Value $updated -Encoding utf8
