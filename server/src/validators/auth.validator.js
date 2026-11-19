const { z } = require('zod')

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
})

module.exports = { loginBody }
