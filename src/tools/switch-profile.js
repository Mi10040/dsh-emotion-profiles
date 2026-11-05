/**
 * `emotion_switch_profile` — switch the active emotion profile at runtime.
 *
 * The switch is global (it applies to every session in this Harness) and
 * persists both the new active id and the previous profile's state snapshot.
 * The tool reports the resulting state so the model can mention it; the mood
 * line itself still comes from runtime-context on the next assembly.
 */
export const SWITCH_TOOL_NAME = 'emotion_switch_profile'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    active: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    valence: { type: 'number' },
    arousal: { type: 'number' },
    text: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok', 'active'],
}

export function makeSwitchTool(service) {
  return {
    name: SWITCH_TOOL_NAME,
    description:
      'Switch the active emotion profile for this Harness. The mood is global: it applies to every session, and each profile keeps its own persisted valence/arousal state (a profile that was never used starts from its configured start state). ' +
      'Use it when the user asks for a different tone or personality. Built-in ids: gentle, cold, passionate, joyful, sad, angry, anxious, calm, playful, tender, proud, curious. Custom ids and display names are also accepted.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: {
          type: 'string',
          description: 'Profile id (e.g. "gentle") or display name (e.g. "温柔"). Use the id when possible.',
        },
      },
      required: ['profile'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        if (!value || typeof value !== 'object') return [{ type: 'text', text: 'Emotion profile: unknown' }]
        if (value.ok) {
          const name = value.name || value.active
          return [{ type: 'text', text: `Emotion profile → ${name}${value.text ? `（${value.text}）` : ''}` }]
        }
        return [{ type: 'text', text: `Emotion profile switch failed: ${value.error || 'unknown error'}` }]
      },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Switch emotion profile',
      kind: 'other',
      rawInput: args && typeof args.profile === 'string' ? args.profile : undefined,
    }),
    async execute(args) {
      const key = args && typeof args.profile === 'string' ? args.profile.trim() : ''
      if (key === '') return { ok: false, active: service.activeId, error: 'profile is required' }
      try {
        const view = await service.switchProfile(key, 'tool')
        return {
          ok: true,
          active: view.active,
          name: view.profile?.name ?? view.active,
          description: view.profile?.description ?? '',
          valence: Number(view.state?.valence?.toFixed?.(4) ?? view.state?.valence ?? 0),
          arousal: Number(view.state?.arousal?.toFixed?.(4) ?? view.state?.arousal ?? 0),
          text: view.moodText ?? '',
        }
      } catch (error) {
        return {
          ok: false,
          active: service.activeId,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
