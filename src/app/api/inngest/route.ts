import { serve } from 'inngest/next'
import { inngest } from '../../../lib/inngest'
import { ingestionFunctions } from '../../../lib/jobs/functions'

// Create the Inngest API route handler
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: ingestionFunctions,
})