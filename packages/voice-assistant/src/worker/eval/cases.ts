import type {EvalCase} from '../../shared/api'

// Expected args are matched loosely (see score.ts): only listed keys are checked, strings
// match case-insensitively if either contains the other. Keep expectations to what the
// utterance pins down unambiguously.
export const EVAL_CASES: EvalCase[] = [
	{
		id: 'alarm-basic',
		text: 'Set an alarm for 6:45 tomorrow morning',
		expect: [{tool: 'create_alarm', args: {time: '06:45'}}],
	},
	{
		id: 'alarm-label',
		text: 'wake me up at 7 with an alarm called gym',
		expect: [{tool: 'create_alarm', args: {time: '07:00', label: 'gym'}}],
	},
	{
		id: 'alarm-pm',
		text: 'alarm at 2:30 pm please',
		expect: [{tool: 'create_alarm', args: {time: '14:30'}}],
	},
	{
		id: 'note-basic',
		text: 'Take a note: the garage code is 4512',
		expect: [{tool: 'create_note', args: {body: '4512'}}],
	},
	{
		id: 'note-idea',
		text: 'note to self, podcast idea about home automation for renters',
		expect: [{tool: 'create_note', args: {body: 'home automation'}}],
	},
	{
		id: 'reminder-time',
		text: 'Remind me to call mom at 5pm',
		expect: [{tool: 'create_reminder', args: {text: 'call mom'}}],
	},
	{
		id: 'reminder-notime',
		text: 'remind me to buy dog food',
		expect: [{tool: 'create_reminder', args: {text: 'dog food'}}],
	},
	{
		id: 'reminder-vs-alarm',
		text: "Don't let me forget to take the trash out tonight",
		expect: [{tool: 'create_reminder', args: {text: 'trash'}}],
	},
	{
		id: 'linear-basic',
		text: 'Create a Linear ticket to fix the login redirect bug',
		expect: [{tool: 'create_linear_ticket', args: {title: 'login redirect'}}],
	},
	{
		id: 'linear-priority',
		text: 'file an urgent issue in linear: checkout page is returning 500s',
		expect: [
			{tool: 'create_linear_ticket', args: {priority: 'urgent', title: 'checkout'}},
		],
	},
	{id: 'car-basic', text: 'Start my car', expect: [{tool: 'start_car_ac'}]},
	{
		id: 'car-temp',
		text: 'cool down the car to 68 degrees',
		expect: [{tool: 'start_car_ac', args: {temperatureF: 68}}],
	},
	{
		id: 'light-on',
		text: 'Turn on the kitchen light',
		expect: [{tool: 'set_light', args: {light: 'kitchen', on: true}}],
	},
	{
		id: 'light-off',
		text: 'lights off in the bedroom',
		expect: [{tool: 'set_light', args: {light: 'bedroom', on: false}}],
	},
	{
		id: 'light-dim',
		text: 'set the living room lamp to 30 percent',
		expect: [{tool: 'set_light', args: {light: 'living room', brightness: 30}}],
	},
	{
		id: 'multi-car-light',
		text: "I'm heading out, start the car AC and turn off the office light",
		expect: [
			{tool: 'start_car_ac'},
			{tool: 'set_light', args: {light: 'office', on: false}},
		],
	},
	{
		id: 'multi-alarm-reminder',
		text: 'set an alarm for 6am and remind me to pack my passport',
		expect: [
			{tool: 'create_alarm', args: {time: '06:00'}},
			{tool: 'create_reminder', args: {text: 'passport'}},
		],
	},
	{id: 'none-weather', text: "What's the weather like today?", expect: []},
	{id: 'none-chitchat', text: 'thanks, that is all', expect: []},
	{
		id: 'asr-noise',
		text: 'uh can you like turn the uh porch light on',
		expect: [{tool: 'set_light', args: {light: 'porch', on: true}}],
	},
]
