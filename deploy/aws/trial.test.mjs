import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const template = JSON.parse(await readFile(new URL('./trial.cloudformation.json', import.meta.url), 'utf8'));
const resources = template.Resources;
const ref = (name) => ({ Ref: name });
const sub = (value) => ({ 'Fn::Sub': value });
const entriesOfType = (type) => Object.entries(resources).filter(([, value]) => value.Type === type);
const asArray = (value) => Array.isArray(value) ? value : [value];

function visit(value, check) {
  check(value);
  if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child, check);
}

test('trial imports only a reviewed AMI and DNS zone, never existing application infrastructure or private IDs', () => {
  assert.deepEqual(Object.keys(template.Parameters).sort(), ['HostedZoneId', 'Hostname', 'ImageId']);
  assert.equal(template.Parameters.ImageId.Type, 'AWS::EC2::Image::Id');
  assert.equal(template.Parameters.HostedZoneId.Type, 'AWS::Route53::HostedZone::Id');
  assert.equal(template.Parameters.Hostname.Type, 'String');
  for (const parameter of Object.values(template.Parameters)) assert.equal(parameter.Default, undefined);
  assert.equal(template.Transform, undefined, 'macros could introduce unreviewed resources');
  const symbols = new Set([...Object.keys(resources), ...Object.keys(template.Parameters), 'AWS::StackName', 'AWS::Partition']);
  visit(template, (value) => {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /\b(?:i|vpc|subnet|sg|igw|rtb|ami|eipalloc)-[a-f0-9]{8,}\b/i);
      assert.doesNotMatch(value, /arn:[^:\s]+:[^:\s]*:[^:\s]*:\d{12}:/);
      return;
    }
    if (!value || typeof value !== 'object') return;
    assert.equal(value['Fn::ImportValue'], undefined, 'cross-stack imports can couple trial to another application');
    if (value.Ref) assert.ok(symbols.has(value.Ref), 'unreviewed Ref: ' + value.Ref);
    if (value['Fn::GetAtt']) assert.ok(Object.hasOwn(resources, asArray(value['Fn::GetAtt'])[0]));
    if (value['Fn::Sub']) {
      assert.equal(typeof value['Fn::Sub'], 'string');
      for (const match of value['Fn::Sub'].matchAll(/\$\{([^}]+)\}/g)) assert.ok(symbols.has(match[1].split('.')[0]), 'unreviewed substitution');
    }
  });
  assert.deepEqual(resources.TrialDNS.Properties.HostedZoneId, ref('HostedZoneId'));
  assert.deepEqual(resources.TrialDNS.Properties.Name, ref('Hostname'));
  assert.deepEqual(resources.TrialDNS.Properties.ResourceRecords, [ref('Address')]);
});

test('a dedicated single-host network exposes only HTTP/HTTPS, with no SSH, DB, extra public IP or peering path', () => {
  assert.equal(entriesOfType('AWS::EC2::VPC').length, 1);
  assert.equal(entriesOfType('AWS::EC2::Instance').length, 1);
  assert.equal(entriesOfType('AWS::EC2::EIP').length, 1);
  for (const type of ['AWS::EC2::VPCPeeringConnection', 'AWS::EC2::TransitGatewayAttachment', 'AWS::EC2::NatGateway', 'AWS::ElasticLoadBalancingV2::LoadBalancer']) assert.equal(entriesOfType(type).length, 0);
  const ingress = [];
  for (const [, resource] of entriesOfType('AWS::EC2::SecurityGroup')) {
    assert.deepEqual(resource.Properties.VpcId, ref('Network'));
    ingress.push(...resource.Properties.SecurityGroupIngress ?? []);
  }
  ingress.push(...entriesOfType('AWS::EC2::SecurityGroupIngress').map(([, resource]) => resource.Properties));
  assert.ok(ingress.length > 0);
  for (const rule of ingress) {
    assert.equal(rule.IpProtocol, 'tcp');
    assert.equal(rule.FromPort, rule.ToPort, 'port ranges must not expose database or management ports');
    assert.ok([80, 443].includes(rule.FromPort), 'only the TLS proxy and ACME may receive traffic');
  }
  const server = resources.Server.Properties;
  assert.deepEqual(server.SubnetId, ref('Subnet'));
  assert.deepEqual(server.SecurityGroupIds, [ref('WebSecurityGroup')]);
  assert.equal(server.NetworkInterfaces, undefined, 'additional interfaces need a new isolation review');
  assert.equal(server.KeyName, undefined);
  assert.deepEqual(resources.Subnet.Properties.VpcId, ref('Network'));
  assert.equal(resources.Subnet.Properties.MapPublicIpOnLaunch, false);
  assert.deepEqual(resources.AddressAssociation.Properties.InstanceId, ref('Server'));
  assert.deepEqual(resources.InternetRoute.Properties.GatewayId, ref('Gateway'));
});

test('host data is encrypted and IMDSv2 is mandatory without secret bootstrap data or unlimited CPU billing', () => {
  const server = resources.Server.Properties;
  assert.equal(server.MetadataOptions.HttpTokens, 'required');
  assert.equal(server.MetadataOptions.HttpPutResponseHopLimit, 1);
  assert.equal(server.MetadataOptions.InstanceMetadataTags, 'disabled');
  assert.equal(server.CreditSpecification.CPUCredits, 'standard');
  assert.equal(server.UserData, undefined, 'bootstrap command bodies must not become a secret delivery mechanism');
  assert.ok(server.BlockDeviceMappings.length > 0);
  for (const device of server.BlockDeviceMappings) {
    assert.equal(device.Ebs.Encrypted, true);
    assert.equal(device.Ebs.VolumeType, 'gp3');
  }
  assert.deepEqual(server.IamInstanceProfile, ref('InstanceProfile'));
  assert.deepEqual(resources.InstanceProfile.Properties.Roles, [ref('InstanceRole')]);
});

test('SSM cannot read other application parameters and the host can only read releases or write backups', () => {
  const role = resources.InstanceRole.Properties;
  assert.deepEqual(role.AssumeRolePolicyDocument.Statement, [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }]);
  assert.deepEqual(role.ManagedPolicyArns, [sub('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore')]);
  const statements = role.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
  for (const action of ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'ssm:GetParameterHistory']) {
    assert.ok(statements.some((statement) => statement.Effect === 'Deny' && asArray(statement.Action).includes(action)
      && statement.Resource === '*' && statement.Condition === undefined), 'managed SSM policy needs unconditional denial: ' + action);
  }
  const allowed = new Map([
    ['s3:GetObject', sub('${Artifacts.Arn}/releases/*')],
    ['s3:PutObject', sub('${Artifacts.Arn}/backups/*')],
    ['s3:AbortMultipartUpload', sub('${Artifacts.Arn}/backups/*')],
  ]);
  const granted = new Set();
  for (const statement of statements) {
    assert.equal(statement.NotAction, undefined);
    assert.equal(statement.NotResource, undefined);
    if (statement.Effect !== 'Allow') continue;
    for (const action of asArray(statement.Action)) {
      assert.ok(allowed.has(action), 'unreviewed instance permission: ' + action);
      assert.deepEqual(statement.Resource, allowed.get(action), 'permissions must remain within their own artifact prefix');
      granted.add(action);
    }
  }
  assert.deepEqual([...granted].sort(), [...allowed.keys()].sort());
});

test('backup storage stays private, encrypted, versioned and retained, and rejects plaintext HTTP for bucket and objects', () => {
  const bucket = resources.Artifacts;
  for (const key of ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']) assert.equal(bucket.Properties.PublicAccessBlockConfiguration[key], true);
  assert.deepEqual(bucket.Properties.OwnershipControls.Rules, [{ ObjectOwnership: 'BucketOwnerEnforced' }]);
  assert.equal(bucket.Properties.AccessControl, undefined);
  assert.equal(bucket.Properties.VersioningConfiguration.Status, 'Enabled');
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  assert.equal(bucket.DeletionPolicy, 'Retain');
  assert.equal(bucket.UpdateReplacePolicy, 'Retain');
  assert.equal(resources.ArtifactsPolicy.DeletionPolicy, 'Retain', 'retained backup buckets must retain their TLS enforcement');
  assert.equal(resources.ArtifactsPolicy.UpdateReplacePolicy, 'Retain', 'replaced backup buckets must retain their TLS enforcement');
  const policy = resources.ArtifactsPolicy.Properties;
  assert.deepEqual(policy.Bucket, ref('Artifacts'));
  assert.ok(policy.PolicyDocument.Statement.every((statement) => statement.Effect === 'Deny'), 'no public or cross-account grant belongs in the bucket policy');
  const deny = policy.PolicyDocument.Statement.find((statement) => statement.Principal === '*' && statement.Action === 's3:*');
  assert.ok(deny);
  assert.deepEqual(deny.Condition, { Bool: { 'aws:SecureTransport': 'false' } });
  assert.deepEqual(deny.Resource, [{ 'Fn::GetAtt': ['Artifacts', 'Arn'] }, sub('${Artifacts.Arn}/*')]);
});
