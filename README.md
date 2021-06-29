# Serverless Functions on AWS

&nbsp;

## How to use this template?

1. Click "Use this template" and create a new repo under the same organization

2. Edit the file `serverless.yml`:
    
    * Change `PROJECT` to your AWS project name (with spaces and owner).

      > Example: `Base Assets Squad by Zlotin`

    * This template has two functions. If you don't need *writer* that is scheduled repeatedly and *reader* that is triggered by GET requests, edit `functions` to create the functions you need. See [serverless.com reference](https://www.serverless.com/framework/docs/providers/aws/guide/serverless.yml/) and [serverless.com examples](https://www.serverless.com/examples/).

3. Edit the file `handler.ts` to add your logic.

4. Your changes will automatically deploy to AWS on every commmit to master. See the deploy log in Github Actions to get the *reader* URL endpoint on AWS.

    > TIP: Let the deploy workflow complete before committing again. Never cancel a deploy workflow to avoid corrupting AWS.

5. To monitor your lambda or get execution/error logs, login to AWS console and open Lambda under the region defined in `serverless-provider.yml`. Your function names will start with the name of your repo.

6. When you don't need your functions anymore, please clean up and delete your AWS resources by going to Github Actions and running the `delete lambda` workflow manually.

&nbsp;

## What does this template provide?

* A *writer* function that is triggered every X minutes that is supposed to do various checks, crunch some data and write the result as JSON ready for consumption by clients (AJAX).

* A *reader* function that is triggered by GET requests and takes an example parameter. See the deploy log in Github Actions to get the actual URL endpoint on AWS.

* Ability to read and write persistent data to AWS EFS. You will receive your own directory specified in `process.env.HOME_DIR`.

* Automatic CI using Github Actions that will deploy your lambda functions to AWS on every commit to master. You don't need to open AWS console at all, not even for the first deployment.

### Do you need to configure anything manually on AWS?

* The template relies on several shared resources on AWS that were already created manually. You're not supposed to create any AWS resources yourself.

* Log retention - TBD

&nbsp;

## How did we initially setup the environment? (so we don't forget)

### Overview

* CI - Github Actions with [serverless.com framework](https://www.serverless.com) as the deploy tool

* API Keys - TBD

* Logging - automatic through AWS CloudWatch (TBD)

* Metrics - Grafana Cloud (TBD)

### AWS initial setup

* Create a VPC that has a private subnet with a NAT (with elastic IP) and a public subnet connected to the Internet according to this [blog post](https://aws.amazon.com/premiumsupport/knowledge-center/internet-access-lambda-function/).

* Create an EFS instance and mount it on the private subnet in the VPC. Create an Access Point:

    ```
    Root directory path: /efs
    POSIX user:
      User ID: 1000
      Group ID: 1000
    Root directory creation permissions:
      Owner user ID: 1000
      Owner group ID: 1000
      Permissions: 0777
    ```

### Github initial setup

* Create Github organization secrets that includes the resource IDs on AWS. The CI workflow pulls them from Github secrets and injects them as environment variables for the serverless.com deploy tool. These incluse the AWS credentials (an AWS user was created for the CI), ARN accesspoint for the EFS instance, a security group for EFS access and a subnet ID for EFS access.

### Hardening permissions

* Limit the CI user with a policy according to this [post](https://serverless-stack.com/chapters/customize-the-serverless-iam-policy.html).
