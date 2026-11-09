# Registers the hourly "whimsy-spike0" task for spike 0 (#16). Runs as you, only while you're signed in,
# with no window and no password. The queue disables the task itself when every job is done or given up.
# Remove it any time with:  Unregister-ScheduledTask -TaskName whimsy-spike0 -Confirm:$false
$dir = 'C:\Users\david\whimsy-capture\spike0'
$action = New-ScheduledTaskAction -Execute "$dir\.venv\Scripts\pythonw.exe" -Argument "-I `"$dir\scripts\spike_queue.py`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'whimsy-spike0' -Description 'Spike 0 (#16): hourly free Hugging Face generation queue; disables itself when done.' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName 'whimsy-spike0' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime | Format-List
