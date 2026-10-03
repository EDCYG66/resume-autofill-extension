param([string]$SnapshotPath = '', [switch]$ReportOnly, [string]$WidgetAssetsPath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow
$work = Join-Path $PSScriptRoot ('输出\ehire-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$source = if ($SnapshotPath) { (Get-Item -LiteralPath $SnapshotPath).FullName } else { Join-Path $PSScriptRoot 'ehire-fixture.html' }
$html = Get-Content -LiteralPath $source -Raw -Encoding UTF8
if ($SnapshotPath) {
  # Saved ASP.NET pages contain postback handlers and analytics. Test the captured DOM offline.
  $html = [regex]::Replace($html, '<script\b[^>]*>[\s\S]*?</script\s*>', '', 'IgnoreCase')
  $html = [regex]::Replace($html, '\s+on\w+\s*=\s*"[^"]*"', '', 'IgnoreCase')
  $html = [regex]::Replace($html, "\s+on\w+\s*=\s*'[^']*'", '', 'IgnoreCase')
}
$baseUri = [Uri]::new($source).AbsoluteUri
$html = [regex]::Replace($html, '<head[^>]*>', ('$0<base href="' + $baseUri + '"><meta http-equiv="Content-Security-Policy" content="default-src ''none''; script-src ''unsafe-inline'' file:; style-src ''unsafe-inline'' file:; img-src file: data:; font-src file: data:; form-action ''none''">'), 'IgnoreCase')
$contentUri = [Uri]::new((Join-Path $root 'content.js')).AbsoluteUri
$probe = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ehire-probe.js') -Raw -Encoding UTF8
$widgetScripts = ''
if ($WidgetAssetsPath) {
  foreach ($name in @('jquery-ehireplus.js.下载','autocompletecomboboxlib.js.下载','autocompletecombobox.js.下载')) {
    $path = (Get-Item -LiteralPath (Join-Path $WidgetAssetsPath $name)).FullName
    $widgetScripts += '<script src="' + [Uri]::new($path).AbsoluteUri + '"></script>'
  }
  $widgetScripts += '<script>document.querySelectorAll(".custom-combobox").forEach(function(el){el.remove();}); jQuery("dl dd select[id*=School],dl dd select[id*=Major],#cc_CCA2_1_1,#cc_CCA4_1_1").combobox();</script>'
}
$position = $html.LastIndexOf('</body>', [StringComparison]::OrdinalIgnoreCase)
if ($position -lt 0) { throw 'No body in source snapshot.' }
$html = $html.Insert($position, ($widgetScripts + '<script src="' + $contentUri + '"></script><script>' + $probe + '</script>'))
$testFile = Join-Path $work 'fixture.html'
[IO.File]::WriteAllText($testFile, $html, [Text.UTF8Encoding]::new($false))
$stdout = Join-Path $work 'stdout.html'
$stderr = Join-Path $work 'stderr.txt'
$process = Start-Process -FilePath $browser -ArgumentList @('--headless=new','--disable-gpu','--allow-file-access-from-files','--no-first-run', (Quote-Arg "--user-data-dir=$work\profile"),'--virtual-time-budget=18000','--dump-dom',[Uri]::new($testFile).AbsoluteUri) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exit=$($process.ExitCode)." }
$dom = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8
$match = [regex]::Match($dom, '<pre id="ehire-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success -or -not $match.Groups[1].Value) { throw 'The eHire test produced no result.' }
$json = [Net.WebUtility]::HtmlDecode($match.Groups[1].Value)
$data = $json | ConvertFrom-Json
if ($data.error) { throw $data.error }
[IO.File]::WriteAllText((Join-Path $work 'report.json'), $json, [Text.UTF8Encoding]::new($false))
if ($ReportOnly) { $data | ConvertTo-Json -Depth 8; return }
if ($data.correct -ne 12 -or $data.submitAttempts -ne 0 -or -not $data.absentSecondNotReused -or -not $data.missingThirdNotReused -or -not $data.missingOptionSafe -or -not $data.schoolRoleNotJob -or -not $data.inactiveOtherNotFilled -or -not $data.otherChoiceFillsSameRecord -or ($WidgetAssetsPath -and -not $data.widgetLoaded)) {
  throw "eHire regression failed. Actual: $json"
}
Write-Output "eHire regression passed: $($data.correct)/12 fields mapped and read back; native/display values agree; missing records/options stay safe; submitAttempts=0."
