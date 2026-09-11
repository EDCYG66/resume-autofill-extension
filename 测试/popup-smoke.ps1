# Drives popup.js through the field-assignment flow: scan -> assign an unrecognised field to
# a built-in one -> save -> fill. popup.js has no other automated coverage, and the assignment
# path touches selection state, the fill payload and what gets persisted.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser = Get-TestBrowserOrThrow

$tempRoot = Join-Path $root '测试\输出'
$profile = Join-Path $tempRoot 'popup-smoke-profile'
$stdout = Join-Path $tempRoot 'popup-smoke-stdout.txt'
$stderr = Join-Path $tempRoot 'popup-smoke-stderr.txt'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

$fixture = [Uri]::new((Join-Path $PSScriptRoot 'popup-fixture.html')).AbsoluteUri
$process = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run',
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=5000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$dom = Get-Content -Raw -LiteralPath $stdout
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The popup fixture produced no result.' }
$steps = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
if ($steps.Count -lt 5) { throw "Expected the full flow, got $($steps.Count) steps." }

$byStage = @{}
foreach ($step in $steps) { $byStage[$step.stage] = $step }

if (-not $byStage.ContainsKey('after scan')) { throw 'The scan step did not run.' }
if ($byStage['after scan'].rows[0].badge -ne '资料里没有') { throw 'An unrecognised field should start as 资料里没有.' }
if ($byStage['after scan'].saveDisabled -ne $true) { throw 'Save should be disabled before any choice is made.' }

if ($byStage['after assigning'].rows[0].badge -ne '已对上') { throw 'Assigning should change the badge to 已对上.' }
if ($byStage['after assigning'].rows[0].value -ne '示例大学') { throw 'Assigning should prefill the value from the profile.' }
if ($byStage['after assigning'].saveDisabled -ne $false) { throw 'Save should be enabled once a field is assigned.' }

$saved = $byStage['after saving the assignment']
if ($saved.fillDisabled -ne $false) { throw 'An assigned field should be fillable.' }
if ($saved.saveLabel -ne '记住这一项') { throw "Unexpected save label: $($saved.saveLabel)" }

$payload = $byStage['fill payload']
if (-not $payload) { throw 'The fill step did not run.' }
if ($payload.fields.Count -ne 1) { throw "Expected one field in the fill payload, got $($payload.fields.Count)." }
if ($payload.fields[0].profileKey -ne 'education.1.school') { throw "Wrong profile key: $($payload.fields[0].profileKey)" }
if ($payload.fields[0].value -ne '示例大学') { throw "Wrong value: $($payload.fields[0].value)" }

$stored = $byStage['stored label_mappings']
if (-not $stored -or $stored.mappings.Count -ne 1) { throw 'The assignment was not persisted.' }
if ($stored.mappings[0].label -ne '学习经历') { throw "Wrong learned label: $($stored.mappings[0].label)" }
if ($stored.mappings[0].profile_key -ne 'education.1.school') { throw "Wrong learned key: $($stored.mappings[0].profile_key)" }

Write-Output 'Popup assignment smoke test passed: scan, assign, save and fill payload all consistent.'
