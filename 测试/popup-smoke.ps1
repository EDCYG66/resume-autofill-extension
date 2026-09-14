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
  (Quote-Arg "--user-data-dir=$profile"), '--virtual-time-budget=12000', '--dump-dom', $fixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if ($process.ExitCode -ne 0) { throw "Browser exited with code $($process.ExitCode)." }

$dom = Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout
$match = [regex]::Match($dom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $match.Success) { throw 'The popup fixture produced no result.' }
$steps = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value) | ConvertFrom-Json
if ($steps.Count -lt 5) { throw "Expected the full flow, got $($steps.Count) steps." }

$byStage = @{}
foreach ($step in $steps) { $byStage[$step.stage] = $step }

if (-not $byStage.ContainsKey('after scan')) { throw 'The scan step did not run.' }
if (-not $byStage.ContainsKey('stored scan') -or $byStage['stored scan'].present -ne $true) { throw 'The scan result was not persisted for popup restoration.' }
if ($byStage['stored scan'].candidateCount -ne 2) { throw "The persisted scan should contain two candidates, got $($byStage['stored scan'].candidateCount)." }
# The cache sits in storage beside the profile, so a sensitive column is persisted as an identity
# and nothing else: its value has to come back from the profile, not from a second copy.
if ($byStage['stored scan'].sensitiveValue) { throw "The persisted scan carries the sensitive value '$($byStage['stored scan'].sensitiveValue)'." }
if ($byStage['after scan'].rows[0].badge -ne '资料里没有') { throw 'An unrecognised field should start as 资料里没有.' }
if ($byStage['after scan'].saveDisabled -ne $true) { throw 'Save should be disabled before any choice is made.' }

$sensitive = $byStage['sensitive row after scan']
if (-not $sensitive) { throw 'The sensitive row step did not run.' }
if ($sensitive.badge -ne '需自己勾选') { throw "A sensitive column should be labelled 需自己勾选, got '$($sensitive.badge)'." }
if ($sensitive.checked -ne $false) { throw 'A sensitive column must not be ticked for the applicant.' }
if ($sensitive.disabled -ne $false) { throw 'The applicant must still be able to tick a sensitive column themselves.' }

if ($byStage['after assigning'].rows[0].badge -ne '已对上') { throw 'Assigning should change the badge to 已对上.' }
if ($byStage['after assigning'].rows[0].value -ne '示例大学') { throw 'Assigning should prefill the value from the profile.' }
if ($byStage['after assigning'].saveDisabled -ne $false) { throw 'Save should be enabled once a field is assigned.' }

$saved = $byStage['after saving the assignment']
if ($saved.fillDisabled -ne $false) { throw 'An assigned field should be fillable.' }
if ($saved.saveLabel -ne '记住这一项') { throw "Unexpected save label: $($saved.saveLabel)" }

$payload = $byStage['fill payload']
if (-not $payload) { throw 'The fill step did not run.' }
# Two entries: the assigned column, plus the sensitive one the driver ticked by hand.
if ($payload.fields.Count -ne 2) { throw "Expected two fields in the fill payload, got $($payload.fields.Count)." }
$assigned = @($payload.fields | Where-Object { $_.profileKey -eq 'education.1.school' })
if ($assigned.Count -ne 1) { throw 'The assigned column is missing from the fill payload.' }
if ($assigned[0].value -ne '示例大学') { throw "Wrong value: $($assigned[0].value)" }
$sensitiveField = @($payload.fields | Where-Object { $_.profileKey -eq 'basic.id_number' })
if ($sensitiveField.Count -ne 1) { throw 'A sensitive column ticked by hand should reach the page.' }

$quick = $byStage['quick copy']
if (-not $quick) { throw 'The 资料速查 step did not run.' }
# The list is built from the shared field catalog, so it reaches sections and list-shaped fields
# the old hand-written table never covered.
if ($quick.coversAdditional -ne $true) { throw '资料速查 should cover the 附加信息 section.' }
if ($quick.coversIdNumber -ne $true) { throw '资料速查 should offer 证件号码.' }
if ($quick.coversCourses -ne $true) { throw '资料速查 should offer the course list.' }
# A floor only: the fixture profile is deliberately small, so this just catches the list
# coming back empty for a whole shape of section. The content checks above are the real ones.
if ($quick.count -lt 6) { throw "资料速查 only produced $($quick.count) entries." }

$stored = $byStage['stored label_mappings']
if (-not $stored -or $stored.mappings.Count -ne 1) { throw 'The assignment was not persisted.' }
if ($stored.mappings[0].label -ne '学习经历') { throw "Wrong learned label: $($stored.mappings[0].label)" }
if ($stored.mappings[0].profile_key -ne 'education.1.school') { throw "Wrong learned key: $($stored.mappings[0].profile_key)" }

# Reopening the popup used to drop the scan: Chrome closes the panel as soon as the applicant
# clicks the page. The restore fixture ships a stored scan for the active tab, so the review
# list has to come back without pressing 看看这页要填什么.
$restoreFixture = [Uri]::new((Join-Path $PSScriptRoot 'popup-restore-fixture.html')).AbsoluteUri
$restoreProfile = Join-Path $tempRoot 'popup-restore-profile'
$restoreStdout = Join-Path $tempRoot 'popup-restore-stdout.txt'
$restoreStderr = Join-Path $tempRoot 'popup-restore-stderr.txt'
New-Item -ItemType Directory -Force -Path $restoreProfile | Out-Null
$restoreProcess = Start-Process -FilePath $browser -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run',
  (Quote-Arg "--user-data-dir=$restoreProfile"), '--virtual-time-budget=12000', '--dump-dom', $restoreFixture
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $restoreStdout -RedirectStandardError $restoreStderr
if ($restoreProcess.ExitCode -ne 0) { throw "Restore fixture browser exited with code $($restoreProcess.ExitCode)." }
$restoreDom = Get-Content -Raw -Encoding UTF8 -LiteralPath $restoreStdout
$restoreMatch = [regex]::Match($restoreDom, '<pre id="smoke-result">(.*?)</pre>', 'Singleline')
if (-not $restoreMatch.Success) { throw 'The restore fixture produced no result.' }
$restore = [System.Net.WebUtility]::HtmlDecode($restoreMatch.Groups[1].Value) | ConvertFrom-Json
if ($restore.restored -ne $true) { throw 'Reopening the popup did not restore the previous scan.' }
if ($restore.rows -ne 2) { throw "Expected 2 restored rows, got $($restore.rows)." }
# The stored copy has no sensitive value, so the row only shows one if it was read back from the
# profile on the way in.
if ($restore.sensitiveValue -ne '210000200001010000') { throw "A restored sensitive row should offer the profile value, got '$($restore.sensitiveValue)'." }
if ($restore.status -notmatch '恢复') { throw "The status line should mention the restored scan, got '$($restore.status)'." }

Write-Output ("Popup smoke test passed: scan, assign, save and fill consistent; " + "sensitive column stays unticked until asked and never lands in the scan cache; " + "reopening restores the scan and reads the sensitive value back from the profile; " + "资料速查 lists " + $quick.count + " entries.")
