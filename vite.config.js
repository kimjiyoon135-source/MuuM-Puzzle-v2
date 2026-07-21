import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(() => {
  const repository = process.env.GITHUB_REPOSITORY || ''
  const repoName = repository.split('/')[1] || ''
  const isUserOrOrgPages = repoName.endsWith('.github.io')
  const base = repoName && !isUserOrOrgPages ? `/${repoName}/` : '/'

  return {
    base,
    plugins: [react()],
  }
})
