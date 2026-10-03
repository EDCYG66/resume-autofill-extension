param([string]$SnapshotPath='', [switch]$ReportOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'browser.ps1')
$browser=Get-TestBrowserOrThrow
$work=Join-Path $PSScriptRoot ('输出\crpower-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$source=if($SnapshotPath){(Get-Item -LiteralPath $SnapshotPath).FullName}else{Join-Path $PSScriptRoot 'crpower-fixture.html'}
$html=Get-Content -LiteralPath $source -Raw -Encoding UTF8
if($SnapshotPath){$html=[regex]::Replace($html,'<script\b[^>]*>[\s\S]*?</script\s*>','','IgnoreCase');$html=[regex]::Replace($html,'\s+on\w+\s*=\s*"[^"]*"','','IgnoreCase');$html=[regex]::Replace($html,"\s+on\w+\s*=\s*'[^']*'",'','IgnoreCase')}
$base=[Uri]::new($source).AbsoluteUri
$html=[regex]::Replace($html,'<head[^>]*>',('$0<base href="'+$base+'"><meta http-equiv="Content-Security-Policy" content="default-src ''none''; script-src ''unsafe-inline'' file:; style-src ''unsafe-inline'' file:; img-src file: data:; form-action ''none''">'),'IgnoreCase')
$pos=$html.LastIndexOf('</body>',[StringComparison]::OrdinalIgnoreCase)
$probe=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'crpower-probe.js') -Raw -Encoding UTF8
$html=$html.Insert($pos,('<script src="'+[Uri]::new((Join-Path $root 'content.js')).AbsoluteUri+'"></script><script>'+$probe+'</script>'))
$test=Join-Path $work 'fixture.html';[IO.File]::WriteAllText($test,$html,[Text.UTF8Encoding]::new($false))
$stdout=Join-Path $work 'stdout.html';$stderr=Join-Path $work 'stderr.txt'
$process=Start-Process -FilePath $browser -ArgumentList @('--headless=new','--disable-gpu','--allow-file-access-from-files','--no-first-run',(Quote-Arg "--user-data-dir=$work\profile"),'--virtual-time-budget=20000','--dump-dom',[Uri]::new($test).AbsoluteUri) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if($process.ExitCode -ne 0){throw 'Browser failed.'}
$dom=Get-Content -LiteralPath $stdout -Raw -Encoding UTF8
$match=[regex]::Match($dom,'<pre id="crpower-result">(.*?)</pre>','Singleline')
if(-not $match.Success -or -not $match.Groups[1].Value){throw 'No CR Power report.'}
$json=[Net.WebUtility]::HtmlDecode($match.Groups[1].Value);$data=$json|ConvertFrom-Json
if($data.error){throw $data.error}
[IO.File]::WriteAllText((Join-Path $work 'report.json'),$json,[Text.UTF8Encoding]::new($false))
if($ReportOnly){$data|ConvertTo-Json -Depth 8;return}
if($SnapshotPath){if($data.snapshotCorrect -ne 20){throw "Saved CR Power page mapping regression failed: $json"};Write-Output "Saved CR Power page passed: $($data.count) candidates; 20/20 core fields mapped using synthetic profile. Filling requires the live page runtime.";return}
if($data.correct -ne 20 -or $data.failed.Count -or -not $data.noWrongFamily -or ($data.familyValues -join '|') -ne '家属甲|家属乙|父亲' -or ($data.schoolValues -join '|') -ne '学校甲|学校乙' -or $data.internship -ne '实习测试单位' -or $data.majorValue -ne '电子信息类' -or $data.majorCommitted -ne '电子信息类' -or $data.dateCommitted -ne '2001-06-03' -or -not $data.rankMissingFailed -or -not $data.rankUnchanged -or -not $data.residenceCommitted -or -not $data.firstDegreeNotInferred -or -not $data.noMaximumAsGpa -or -not $data.detachedRecordSafe -or $data.submits -ne 0){throw "CR Power regression failed: $json"}
Write-Output "CR Power regression passed: 20 field mappings, repeated-record readbacks, dialog confirmation, absent rank rejected; submits=0."
