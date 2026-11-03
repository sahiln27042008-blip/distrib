import github2018MysqlPartition from "./github-2018-mysql-partition.ts";
import cloudflareEdgeProxyOverflow from "./cloudflare-edge-proxy-overflow.ts";
import stripeDoubleCharge from "./stripe-double-charge.ts";
import knightCapitalRetryStorm from "./knight-capital-retry-storm.ts";
import awsDynamodbUsEast1Overload from "./aws-dynamodb-us-east-1-overload.ts";
import gitlabDatabaseDeletion from "./gitlab-database-deletion.ts";

export const fixtures = [
  github2018MysqlPartition,
  cloudflareEdgeProxyOverflow,
  stripeDoubleCharge,
  knightCapitalRetryStorm,
  awsDynamodbUsEast1Overload,
  gitlabDatabaseDeletion,
];

export default fixtures;
