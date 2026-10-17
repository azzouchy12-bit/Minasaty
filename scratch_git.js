const { execSync } = require('child_process');

try {
  console.log('Adding files...');
  execSync('git add -A', { stdio: 'inherit' });

  console.log('Committing...');
  execSync('git commit -m "feat(live): enforce strict student microphone readiness and guarantee hybrid SFU video with P2P audio"', { stdio: 'inherit' });

  console.log('Pushing to origin main...');
  execSync('git push origin main', { stdio: 'inherit' });

  console.log('SUCCESS!');
} catch (err) {
  console.error('Git error:', err.message);
  process.exit(1);
}
