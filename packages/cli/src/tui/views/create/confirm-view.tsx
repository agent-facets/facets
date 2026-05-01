import { type ScaffoldOptions as CreateOptions, previewScaffoldFiles } from '@agent-facets/core'
import { Box, Text } from 'ink'
import { useEffect } from 'react'
import { Button } from '../../components/button.tsx'
import { useFocusOrder } from '../../context/focus-order-context.ts'
import { WizardLayout } from '../../layouts/wizard-layout.tsx'
import { THEME } from '../../theme.ts'

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <Box gap={1}>
      <Text color={THEME.success}>✓</Text>
      <Text bold>{label}:</Text>
      <Text>{value}</Text>
    </Box>
  )
}

export function ConfirmView({
  opts,
  onConfirm,
  onBack,
}: {
  opts: CreateOptions
  onConfirm: () => void
  onBack: () => void
}) {
  const files = previewScaffoldFiles(opts)
  const { setFocusIds, focus, focusedId } = useFocusOrder()

  useEffect(() => {
    setFocusIds(['confirm-yes', 'confirm-no'])
    focus('confirm-yes')
  }, [setFocusIds, focus])

  return (
    <WizardLayout>
      <Box flexDirection="column" marginLeft={2}>
        <SummaryField label="Name" value={opts.name} />
        <SummaryField label="Description" value={opts.description} />
        <SummaryField label="Version" value={opts.version} />
        {opts.skills.length > 0 && <SummaryField label="Skills" value={opts.skills.join(', ')} />}
        {opts.agents.length > 0 && <SummaryField label="Agents" value={opts.agents.join(', ')} />}
        {opts.commands.length > 0 && <SummaryField label="Commands" value={opts.commands.join(', ')} />}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={THEME.success} paddingX={2} paddingY={1} gap={0}>
        <Text bold color={THEME.success}>
          Files to create:
        </Text>
        {files.map((f) => (
          <Text key={f}> {f}</Text>
        ))}
      </Box>

      <Box gap={2} marginTop={1}>
        <Button
          id="confirm-yes"
          label="[ Yes, create ]"
          color={THEME.success}
          gradient={focusedId === 'confirm-yes'}
          animateGradient={focusedId === 'confirm-yes'}
          onPress={onConfirm}
        />
        <Button id="confirm-no" label="[ No, go back ]" color={THEME.warning} onPress={onBack} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>← → to switch, Enter to confirm</Text>
      </Box>
    </WizardLayout>
  )
}
