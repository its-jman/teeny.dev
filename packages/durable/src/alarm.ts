type AlarmManagerConfig = {_: never}
/**
 * Ideas:
 *  - extended: extends AlarmManager
 *  - decorator: @alarmManager
 *  - function: this.alarm = createAlarmManager()
 */
export function createAlarmManager<TAlarms>(
	alarms: TAlarms /* cfg?: AlarmManagerConfig */
) {}
