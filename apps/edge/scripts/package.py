#!/usr/bin/env python3
"""Build portable, hash-pinned Edge service bundles. No service/host mutations."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import posixpath
import re
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads(Path(__file__).with_name('assets.json').read_text())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def download(url, expected, cache):
    target = cache / expected
    if target.exists():
        data = target.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(150_000_001)
        if len(data) > 150_000_000:
            raise ValueError('download_too_large')
    if sha(data) != expected:
        raise ValueError('upstream_checksum_mismatch')
    if not target.exists():
        with target.open('xb') as stream:
            stream.write(data)
    return data


def runtime_files(target, cache):
    windows = target.startswith('win32-')
    version = CATALOG['nodeVersion']
    upstream = target.replace('win32-', 'win-')
    prefix = f'node-v{version}-{upstream}'
    extension = '.zip' if windows else '.tar.gz'
    data = download(f'https://nodejs.org/dist/v{version}/{prefix}{extension}', CATALOG['node'][target], cache)
    selected = {prefix + ('/node.exe' if windows else '/bin/node'): 'runtime/' + ('node.exe' if windows else 'node'), prefix + '/LICENSE': 'runtime/LICENSE'}
    result = {}
    # Select regular entries by exact upstream names; never extract arbitrary archive paths.
    if windows:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for source, destination in selected.items():
                matches = [item for item in archive.infolist() if item.filename == source]
                if len(matches) != 1 or matches[0].is_dir() or matches[0].file_size > 150_000_000:
                    raise ValueError('invalid_upstream_entry')
                result[destination] = archive.read(matches[0])
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            for source, destination in selected.items():
                matches = [item for item in archive.getmembers() if item.name == source]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 150_000_000:
                    raise ValueError('invalid_upstream_entry')
                with archive.extractfile(matches[0]) as stream:
                    result[destination] = stream.read()
    return result


def launchers(windows):
    if windows:
        return {'setup.ps1': b'''$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime\\node.exe'
$entry = Join-Path $PSScriptRoot 'setup\\setup.mjs'
& $runtime $entry @args
exit $LASTEXITCODE
'''}
    return {'setup.sh': b'''#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec "$base/runtime/node" "$base/setup/setup.mjs" "$@"
'''}


def manual(release_id):
    """Keep cross-references usable when this Markdown is read outside the repository."""
    revision = release_id[5:] if re.fullmatch(r'ci-[ab]-[0-9a-f]{40}', release_id) else 'main'
    source = (ROOT / 'docs/manual/edge-service-setup.md').read_text(encoding='utf-8')
    def link(match):
        value = match[1]
        if value.startswith('#') or re.match(r'[a-zA-Z]+:', value):
            return match[0]
        path, separator, fragment = value.partition('#')
        relative = posixpath.normpath('docs/manual/' + path)
        if relative.startswith('../') or not (ROOT / relative).exists():
            raise ValueError('invalid_manual_reference')
        return '](https://github.com/adokoy001/DaifukuERP/blob/' + revision + '/' + relative + separator + fragment + ')'
    return re.sub(r'\]\(([^\s)]+)\)', link, source).encode()


def verify_archive(path, name, expected):
    """Read the deliverable back, including executable bits and exact entry topology."""
    expected = {name + '/' + relative: data for relative, data in expected.items()}
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if sorted(item.filename for item in entries) != sorted(expected):
                raise ValueError('archive_entries_mismatch')
            for item in entries:
                if sha(archive.read(item)) != sha(expected[item.filename]):
                    raise ValueError('archive_content_mismatch')
    else:
        with tarfile.open(path, 'r:gz') as archive:
            entries = archive.getmembers()
            if any(not (item.isfile() or item.isdir()) for item in entries):
                raise ValueError('archive_links_forbidden')
            regular = [item for item in entries if item.isfile()]
            if sorted(item.name for item in regular) != sorted(expected):
                raise ValueError('archive_entries_mismatch')
            for item in regular:
                with archive.extractfile(item) as stream:
                    if sha(stream.read()) != sha(expected[item.name]):
                        raise ValueError('archive_content_mismatch')
                if item.uid != 0 or item.gid != 0:
                    raise ValueError('archive_build_identity_exposed')
                if item.name.endswith(('/runtime/node', '/setup.sh')) and item.mode != 0o755:
                    raise ValueError('archive_executable_mode_missing')


def package(target, release_id, output, cache):
    platform, arch = target.split('-')
    files = runtime_files(target, cache)
    dist = ROOT / 'apps/edge/dist'
    for source, destination in [('edge.mjs', 'app/edge.mjs'), ('setup.mjs', 'setup/setup.mjs'), ('LICENSE', 'LICENSE'), ('THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt')]:
        files[destination] = (dist / source).read_bytes()
    files.update(launchers(platform == 'win32'))
    files['config.example.json'] = b'{\n  "apiBaseUrl": "https://erp.example.com/api",\n  "devices": []\n}\n'
    files['README.md'] = manual(release_id)
    if platform == 'win32':
        wrapper = CATALOG['wrapper']
        files['wrapper/WinSW.NET461.exe'] = download(wrapper['url'], wrapper['sha256'], cache)
        files['wrapper/LICENSE'] = download(wrapper['licenseUrl'], wrapper['licenseSha256'], cache)
        for notice in wrapper['notices']:
            files[notice['path']] = download(notice['url'], notice['sha256'], cache)
    name = f'DaifukuEdge-{release_id}-{target}'
    directory = output / name
    directory.mkdir(mode=0o755)
    manifest = {'format': 1, 'kind': 'daifuku-edge-bundle', 'releaseId': release_id, 'platform': platform, 'arch': arch, 'nodeVersion': CATALOG['nodeVersion'], 'files': []}
    for relative, data in sorted(files.items()):
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        executable = relative in ('runtime/node', 'runtime/node.exe', 'setup.sh', 'wrapper/WinSW.NET461.exe')
        path.chmod(0o755 if executable else 0o644)
        manifest['files'].append({'path': relative, 'sha256': sha(data), 'bytes': len(data), 'executable': executable})
    raw = (json.dumps(manifest, indent=2) + '\n').encode()
    (directory / 'manifest.json').write_bytes(raw)
    (output / (name + '.manifest.sha256')).write_text(sha(raw) + '\n')
    archive_path = output / (name + ('.zip' if platform == 'win32' else '.tar.gz'))
    if platform == 'win32':
        with zipfile.ZipFile(archive_path, 'x', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(directory.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(output))
    else:
        with tarfile.open(archive_path, 'x:gz') as archive:
            def public_metadata(entry):
                entry.uid = entry.gid = 0
                entry.uname = entry.gname = ''
                entry.mtime = 0
                return entry
            archive.add(directory, arcname=name, filter=public_metadata)
    verify_archive(archive_path, name, {**files, 'manifest.json': raw})
    (output / (archive_path.name + '.sha256')).write_text(sha(archive_path.read_bytes()) + '  ' + archive_path.name + '\n')
    return {'target': target, 'directory': str(directory), 'archive': str(archive_path), 'manifestHash': sha(raw), 'archiveHash': sha(archive_path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=[*CATALOG['node'], 'all'], required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}', args.release_id):
        raise ValueError('invalid_release_id')
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    targets = CATALOG['node'] if args.target == 'all' else [args.target]
    for target in targets:
        print(json.dumps(package(target, args.release_id, args.output.resolve(), args.cache.resolve())))


if __name__ == '__main__':
    main()
