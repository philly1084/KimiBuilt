'use strict';

const {
  collectK3sCommandHints,
  getRemoteCommandPreflight,
  hasKubectlSetAddBeforeSubcommand,
} = require('./remote-command-safety');

describe('remote-command safety checks', () => {
  test('blocks kubectl set --add before it reaches a remote host', () => {
    const command = 'kubectl set --add volume deployment/gamer -n gamer --name=gamer-html';

    expect(hasKubectlSetAddBeforeSubcommand(command)).toBe(true);
    expect(getRemoteCommandPreflight(command)).toEqual(expect.objectContaining({
      ok: false,
      blockers: [expect.stringContaining('kubectl set --add')],
      hints: [expect.stringContaining('kubectl set volume')],
    }));
  });

  test('allows valid kubectl set volume --add syntax', () => {
    const command = 'kubectl set volume deployment/gamer -n gamer --add --name=gamer-html';

    expect(hasKubectlSetAddBeforeSubcommand(command)).toBe(false);
    expect(getRemoteCommandPreflight(command).ok).toBe(true);
  });

  test('adds k3s-specific hints for common kubectl failures', () => {
    const hints = collectK3sCommandHints({
      command: 'kubectl get pods -A',
      stderr: 'Unable to connect to the server: dial tcp 127.0.0.1:59668: connect: connection refused',
    });

    expect(hints).toEqual(expect.arrayContaining([
      expect.stringContaining('KUBECONFIG=/etc/rancher/k3s/k3s.yaml'),
    ]));
  });
});
