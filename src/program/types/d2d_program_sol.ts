/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/d2d_program_sol.json`.
 */
export type D2dProgramSol = {
  "address": "FFFQCLoNLUqhiAbxYMiKXcN5LxAUSMN4fd2ijgtLnwxD",
  "metadata": {
    "name": "d2dProgramSol",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "adminWithdraw",
      "docs": [
        "Admin withdraw funds from Admin Pool"
      ],
      "discriminator": [
        160,
        166,
        147,
        222,
        46,
        220,
        75,
        224
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "adminPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "adminWithdrawRewardPool",
      "docs": [
        "Admin withdraw funds from Reward Pool"
      ],
      "discriminator": [
        132,
        153,
        226,
        156,
        55,
        217,
        65,
        132
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "claimRewards",
      "docs": [
        "Lender claim accumulated rewards"
      ],
      "discriminator": [
        4,
        144,
        132,
        71,
        116,
        23,
        151,
        80
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "lenderStake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lender"
              }
            ]
          }
        },
        {
          "name": "lender",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "closeProgramAndRefund",
      "docs": [
        "Admin close program and refund recovered lamports to pool"
      ],
      "discriminator": [
        212,
        54,
        165,
        48,
        227,
        66,
        243,
        44
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "requestId"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "refundSource",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "recoveredLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeTreasuryPool",
      "docs": [
        "Close Treasury Pool account (Admin only)",
        "",
        "This closes the treasury pool account and transfers all lamports to admin.",
        "Does NOT require deserializing the account, so it works with old struct layouts.",
        "",
        "After closing, call reinitialize_treasury_pool() to create a new account with the updated layout."
      ],
      "discriminator": [
        74,
        23,
        235,
        188,
        143,
        125,
        223,
        245
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "docs": [
            "We use UncheckedAccount to avoid deserialization (works with old layouts)",
            "PDA seeds are verified by Anchor constraint, so it's safe to use UncheckedAccount"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin who will receive the lamports"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "confirmDeploymentFailure",
      "docs": [
        "Admin confirm deployment failure"
      ],
      "discriminator": [
        166,
        2,
        135,
        189,
        160,
        142,
        133,
        80
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "deploy_request.program_hash",
                "account": "deployRequest"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "ephemeralKey",
          "writable": true,
          "signer": true
        },
        {
          "name": "developerWallet",
          "writable": true
        },
        {
          "name": "treasuryPda",
          "docs": [
            "Note: Recovered funds go back to TreasuryPool, not PlatformPool",
            "PlatformPool only receives 0.1% developer fees"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "failureReason",
          "type": "string"
        }
      ]
    },
    {
      "name": "confirmDeploymentSuccess",
      "docs": [
        "Admin confirm deployment success"
      ],
      "discriminator": [
        22,
        206,
        187,
        119,
        214,
        186,
        236,
        5
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "deploy_request.program_hash",
                "account": "deployRequest"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "ephemeralKey",
          "writable": true,
          "signer": true
        },
        {
          "name": "developerWallet",
          "writable": true
        },
        {
          "name": "treasuryPda",
          "docs": [
            "Note: Recovered funds go back to TreasuryPool, not PlatformPool",
            "PlatformPool only receives 0.1% developer fees"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "deployedProgramId",
          "type": "pubkey"
        },
        {
          "name": "recoveredFunds",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createDeployRequest",
      "docs": [
        "Admin create deploy request after payment verification",
        "Only backend admin can call this after verifying developer payment",
        "Payment has already been transferred to Reward Pool"
      ],
      "discriminator": [
        249,
        143,
        63,
        75,
        67,
        107,
        0,
        146
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "platformPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "docs": [
            "We use UncheckedAccount to handle old layouts, then manually deserialize/resize"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "programHash"
              }
            ]
          }
        },
        {
          "name": "userStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "developer"
              }
            ]
          }
        },
        {
          "name": "developer",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "programHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "serviceFee",
          "type": "u64"
        },
        {
          "name": "monthlyFee",
          "type": "u64"
        },
        {
          "name": "initialMonths",
          "type": "u32"
        },
        {
          "name": "deploymentCost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "creditFeeToPool",
      "docs": [
        "Credit fees to pools and update reward_per_share",
        "Admin/backend only - called when devs pay fees"
      ],
      "discriminator": [
        168,
        40,
        70,
        186,
        61,
        14,
        167,
        178
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "platformPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeReward",
          "type": "u64"
        },
        {
          "name": "feePlatform",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deployProgram",
      "docs": [
        "[DEPRECATED] Deploy program with both developer and admin signatures",
        "Use request_deployment_funds + confirm_deployment_success instead"
      ],
      "discriminator": [
        120,
        79,
        182,
        165,
        160,
        10,
        146,
        229
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "programHash"
              }
            ]
          }
        },
        {
          "name": "userStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "developer"
              }
            ]
          }
        },
        {
          "name": "developer",
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasuryWallet",
          "writable": true
        },
        {
          "name": "ephemeralKey",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "programHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "serviceFee",
          "type": "u64"
        },
        {
          "name": "monthlyFee",
          "type": "u64"
        },
        {
          "name": "initialMonths",
          "type": "u32"
        },
        {
          "name": "deploymentCost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "emergencyPause",
      "docs": [
        "Emergency pause/unpause"
      ],
      "discriminator": [
        21,
        143,
        27,
        142,
        200,
        181,
        210,
        255
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "pause",
          "type": "bool"
        }
      ]
    },
    {
      "name": "fundTemporaryWallet",
      "docs": [
        "Admin fund temporary wallet for deployment",
        "Only backend admin can call this to transfer deployment funds",
        "use_admin_pool: true = use Admin Pool, false = use Reward Pool (preferred)"
      ],
      "discriminator": [
        195,
        217,
        79,
        3,
        185,
        190,
        142,
        89
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "requestId"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasuryPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "temporaryWallet",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "useAdminPool",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize the D2D program and treasury pool"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "platformPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "devWallet"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialApy",
          "type": "u64"
        },
        {
          "name": "devWallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "paySubscription",
      "docs": [
        "Developer pay monthly subscription"
      ],
      "discriminator": [
        214,
        139,
        186,
        253,
        169,
        248,
        196,
        11
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "deploy_request.program_hash",
                "account": "deployRequest"
              }
            ]
          }
        },
        {
          "name": "developer",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasuryWallet",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "months",
          "type": "u32"
        }
      ]
    },
    {
      "name": "reinitializeTreasuryPool",
      "docs": [
        "Reinitialize Treasury Pool (Admin only)",
        "",
        "This reinitializes an existing treasury pool account with new struct layout.",
        "Works even if the account has old layout or is rent-exempt.",
        "",
        "Use this after closing the old account to migrate to new layout."
      ],
      "discriminator": [
        119,
        63,
        199,
        102,
        0,
        102,
        85,
        113
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "docs": [
            "We use UncheckedAccount to avoid deserialization, then manually resize and initialize"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rewardPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "platformPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "devWallet"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initialApy",
          "type": "u64"
        },
        {
          "name": "devWallet",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "requestDeploymentFunds",
      "docs": [
        "Request deployment funds from treasury pool",
        "Backend will use these funds to deploy via pure Web3.js"
      ],
      "discriminator": [
        246,
        241,
        136,
        87,
        141,
        230,
        129,
        244
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "deployRequest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  112,
                  108,
                  111,
                  121,
                  95,
                  114,
                  101,
                  113,
                  117,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "programHash"
              }
            ]
          }
        },
        {
          "name": "userStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "developer"
              }
            ]
          }
        },
        {
          "name": "developer",
          "writable": true,
          "signer": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasuryWallet"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "programHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "serviceFee",
          "type": "u64"
        },
        {
          "name": "monthlyFee",
          "type": "u64"
        },
        {
          "name": "initialMonths",
          "type": "u32"
        },
        {
          "name": "deploymentCost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stakeSol",
      "docs": [
        "Lender stake SOL into treasury pool",
        "Kept for backward compatibility (use create_deposit for new code)"
      ],
      "discriminator": [
        200,
        38,
        157,
        155,
        245,
        57,
        236,
        168
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "lenderStake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lender"
              }
            ]
          }
        },
        {
          "name": "lender",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "lockPeriod",
          "type": "i64"
        }
      ]
    },
    {
      "name": "suspendExpiredPrograms",
      "docs": [
        "Admin suspend expired programs"
      ],
      "discriminator": [
        29,
        248,
        88,
        233,
        133,
        143,
        246,
        89
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "syncLiquidBalance",
      "docs": [
        "Admin sync liquid_balance with actual account balance",
        "This fixes liquid_balance when it's out of sync with account balance"
      ],
      "discriminator": [
        31,
        190,
        73,
        167,
        101,
        188,
        141,
        57
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryPda",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "unstakeSol",
      "docs": [
        "Lender unstake SOL from treasury pool",
        "Kept for backward compatibility (use request_withdraw for new code)"
      ],
      "discriminator": [
        70,
        150,
        140,
        208,
        166,
        13,
        252,
        150
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "lenderStake",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "lender"
              }
            ]
          }
        },
        {
          "name": "lender",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateApy",
      "docs": [
        "Admin update APY"
      ],
      "discriminator": [
        94,
        110,
        147,
        45,
        73,
        167,
        222,
        77
      ],
      "accounts": [
        {
          "name": "treasuryPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newApy",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "backerDeposit",
      "discriminator": [
        233,
        24,
        109,
        17,
        7,
        122,
        24,
        21
      ]
    },
    {
      "name": "deployRequest",
      "discriminator": [
        47,
        91,
        87,
        46,
        78,
        120,
        21,
        217
      ]
    },
    {
      "name": "treasuryPool",
      "discriminator": [
        189,
        10,
        165,
        70,
        135,
        51,
        29,
        117
      ]
    },
    {
      "name": "userDeployStats",
      "discriminator": [
        96,
        138,
        250,
        56,
        106,
        192,
        193,
        187
      ]
    }
  ],
  "events": [
    {
      "name": "adminMovedToRewardPool",
      "discriminator": [
        57,
        140,
        253,
        235,
        44,
        7,
        54,
        26
      ]
    },
    {
      "name": "adminWithdrew",
      "discriminator": [
        128,
        19,
        176,
        57,
        89,
        78,
        139,
        246
      ]
    },
    {
      "name": "apyUpdated",
      "discriminator": [
        128,
        77,
        231,
        153,
        96,
        150,
        84,
        41
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "deployRequested",
      "discriminator": [
        236,
        93,
        153,
        180,
        211,
        112,
        67,
        252
      ]
    },
    {
      "name": "deploymentConfirmed",
      "discriminator": [
        254,
        219,
        210,
        63,
        255,
        22,
        17,
        44
      ]
    },
    {
      "name": "deploymentFailed",
      "discriminator": [
        139,
        230,
        42,
        133,
        244,
        150,
        132,
        16
      ]
    },
    {
      "name": "deploymentFundsRequested",
      "discriminator": [
        24,
        127,
        154,
        179,
        96,
        54,
        84,
        34
      ]
    },
    {
      "name": "depositMade",
      "discriminator": [
        210,
        201,
        130,
        183,
        244,
        203,
        155,
        199
      ]
    },
    {
      "name": "emergencyPauseToggled",
      "discriminator": [
        68,
        107,
        204,
        70,
        158,
        210,
        37,
        175
      ]
    },
    {
      "name": "programClosed",
      "discriminator": [
        3,
        105,
        195,
        187,
        122,
        1,
        142,
        8
      ]
    },
    {
      "name": "programDeployed",
      "discriminator": [
        89,
        227,
        238,
        191,
        128,
        7,
        101,
        15
      ]
    },
    {
      "name": "programsSuspended",
      "discriminator": [
        235,
        69,
        57,
        251,
        27,
        51,
        147,
        36
      ]
    },
    {
      "name": "rewardCredited",
      "discriminator": [
        21,
        16,
        94,
        56,
        44,
        11,
        160,
        202
      ]
    },
    {
      "name": "rewardsClaimed",
      "discriminator": [
        75,
        98,
        88,
        18,
        219,
        112,
        88,
        121
      ]
    },
    {
      "name": "rewardsDistributed",
      "discriminator": [
        11,
        43,
        154,
        0,
        229,
        9,
        116,
        85
      ]
    },
    {
      "name": "solStaked",
      "discriminator": [
        208,
        251,
        85,
        47,
        215,
        38,
        164,
        77
      ]
    },
    {
      "name": "solUnstaked",
      "discriminator": [
        200,
        41,
        161,
        127,
        15,
        134,
        21,
        47
      ]
    },
    {
      "name": "subscriptionPaid",
      "discriminator": [
        204,
        65,
        145,
        54,
        154,
        163,
        113,
        229
      ]
    },
    {
      "name": "temporaryWalletFunded",
      "discriminator": [
        3,
        234,
        196,
        159,
        194,
        85,
        44,
        181
      ]
    },
    {
      "name": "treasuryInitialized",
      "discriminator": [
        199,
        73,
        174,
        205,
        59,
        145,
        55,
        179
      ]
    },
    {
      "name": "withdrawRequested",
      "discriminator": [
        114,
        16,
        240,
        206,
        93,
        128,
        151,
        39
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "programPaused",
      "msg": "Program is currently paused"
    },
    {
      "code": 6001,
      "name": "insufficientDeposit",
      "msg": "Insufficient deposit amount"
    },
    {
      "code": 6002,
      "name": "maxConcurrentSessionsExceeded",
      "msg": "Maximum concurrent sessions exceeded"
    },
    {
      "code": 6003,
      "name": "invalidSessionStatus",
      "msg": "Invalid session status for this operation"
    },
    {
      "code": 6004,
      "name": "maxRetriesExceeded",
      "msg": "Maximum retry attempts exceeded"
    },
    {
      "code": 6005,
      "name": "sessionNotExpired",
      "msg": "Session has not expired yet"
    },
    {
      "code": 6006,
      "name": "unauthorized",
      "msg": "Unauthorized access"
    },
    {
      "code": 6007,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6008,
      "name": "invalidLockPeriod",
      "msg": "Invalid lock period"
    },
    {
      "code": 6009,
      "name": "inactiveStake",
      "msg": "Inactive stake"
    },
    {
      "code": 6010,
      "name": "insufficientStake",
      "msg": "Insufficient stake amount"
    },
    {
      "code": 6011,
      "name": "stakeLocked",
      "msg": "Stake is locked"
    },
    {
      "code": 6012,
      "name": "noRewardsToClaim",
      "msg": "No rewards to claim"
    },
    {
      "code": 6013,
      "name": "insufficientTreasuryFunds",
      "msg": "Insufficient treasury funds"
    },
    {
      "code": 6014,
      "name": "invalidRequestId",
      "msg": "Invalid request ID"
    },
    {
      "code": 6015,
      "name": "invalidRequestStatus",
      "msg": "Invalid request status"
    },
    {
      "code": 6016,
      "name": "invalidDeploymentStatus",
      "msg": "Invalid deployment status"
    },
    {
      "code": 6017,
      "name": "invalidTreasuryWallet",
      "msg": "Invalid treasury wallet"
    },
    {
      "code": 6018,
      "name": "invalidEphemeralKey",
      "msg": "Invalid ephemeral key"
    },
    {
      "code": 6019,
      "name": "calculationOverflow",
      "msg": "Calculation overflow"
    },
    {
      "code": 6020,
      "name": "timeElapsedTooLarge",
      "msg": "Time elapsed too large"
    },
    {
      "code": 6021,
      "name": "negativeTimeElapsed",
      "msg": "Negative time elapsed - clock error detected"
    },
    {
      "code": 6022,
      "name": "invalidRecoveredFunds",
      "msg": "Recovered funds exceed deployment cost"
    },
    {
      "code": 6023,
      "name": "lockPeriodTooLong",
      "msg": "Lock period exceeds maximum allowed (10 years)"
    },
    {
      "code": 6024,
      "name": "insufficientPrincipalFunds",
      "msg": "Insufficient principal funds in treasury pool"
    },
    {
      "code": 6025,
      "name": "feeAmountTooLarge",
      "msg": "Fee amount exceeds maximum allowed"
    },
    {
      "code": 6026,
      "name": "insufficientLiquidBalance",
      "msg": "Insufficient liquid balance for withdrawal"
    },
    {
      "code": 6027,
      "name": "divisionByZero",
      "msg": "Division by zero - total deposits is zero"
    },
    {
      "code": 6028,
      "name": "invalidWithdrawalRequest",
      "msg": "Invalid withdrawal request"
    },
    {
      "code": 6029,
      "name": "invalidAccountOwner",
      "msg": "Invalid account owner - account must be owned by this program"
    }
  ],
  "types": [
    {
      "name": "adminMovedToRewardPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "movedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "adminWithdrew",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "withdrawnAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "apyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldApy",
            "type": "u64"
          },
          {
            "name": "newApy",
            "type": "u64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "backerDeposit",
      "docs": [
        "Backer's deposit position in the pool",
        "",
        "Reward-per-share model:",
        "- deposited_amount: Amount of SOL deposited (net after fees)",
        "- reward_debt: Tracks accumulated rewards at deposit time (deposited_amount * reward_per_share)",
        "- claimed_total: Total rewards claimed so far"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "depositedAmount",
            "type": "u64"
          },
          {
            "name": "rewardDebt",
            "type": "u128"
          },
          {
            "name": "claimedTotal",
            "type": "u64"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimedTotal",
            "type": "u64"
          },
          {
            "name": "rewardPerShare",
            "type": "u128"
          },
          {
            "name": "claimedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deployRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "serviceFee",
            "type": "u64"
          },
          {
            "name": "monthlyFee",
            "type": "u64"
          },
          {
            "name": "deploymentCost",
            "type": "u64"
          },
          {
            "name": "borrowedAmount",
            "type": "u64"
          },
          {
            "name": "subscriptionPaidUntil",
            "type": "i64"
          },
          {
            "name": "ephemeralKey",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "deployedProgramId",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "deployRequestStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "deployRequestStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pendingDeployment"
          },
          {
            "name": "active"
          },
          {
            "name": "subscriptionExpired"
          },
          {
            "name": "suspended"
          },
          {
            "name": "failed"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "deployRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "serviceFee",
            "type": "u64"
          },
          {
            "name": "monthlyFee",
            "type": "u64"
          },
          {
            "name": "initialMonths",
            "type": "u32"
          },
          {
            "name": "totalPayment",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "deploymentConfirmed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "deployedProgramId",
            "type": "pubkey"
          },
          {
            "name": "deploymentCost",
            "type": "u64"
          },
          {
            "name": "recoveredFunds",
            "type": "u64"
          },
          {
            "name": "confirmedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deploymentFailed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "failureReason",
            "type": "string"
          },
          {
            "name": "refundAmount",
            "type": "u64"
          },
          {
            "name": "deploymentCostReturned",
            "type": "u64"
          },
          {
            "name": "failedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "deploymentFundsRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "serviceFee",
            "type": "u64"
          },
          {
            "name": "monthlyFee",
            "type": "u64"
          },
          {
            "name": "initialMonths",
            "type": "u32"
          },
          {
            "name": "deploymentCost",
            "type": "u64"
          },
          {
            "name": "totalPayment",
            "type": "u64"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositMade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "depositAmount",
            "type": "u64"
          },
          {
            "name": "netDeposit",
            "type": "u64"
          },
          {
            "name": "rewardFee",
            "type": "u64"
          },
          {
            "name": "platformFee",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "liquidBalance",
            "type": "u64"
          },
          {
            "name": "depositedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "emergencyPauseToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "toggledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "programClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "programId",
            "type": "pubkey"
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "recoveredLamports",
            "type": "u64"
          },
          {
            "name": "closedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "programDeployed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "programHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "serviceFee",
            "type": "u64"
          },
          {
            "name": "monthlyFee",
            "type": "u64"
          },
          {
            "name": "initialMonths",
            "type": "u32"
          },
          {
            "name": "deploymentCost",
            "type": "u64"
          },
          {
            "name": "ephemeralKey",
            "type": "pubkey"
          },
          {
            "name": "totalPayment",
            "type": "u64"
          },
          {
            "name": "deployedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "programsSuspended",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "suspendedCount",
            "type": "u32"
          },
          {
            "name": "suspendedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardCredited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeReward",
            "type": "u64"
          },
          {
            "name": "feePlatform",
            "type": "u64"
          },
          {
            "name": "rewardPerShare",
            "type": "u128"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "creditedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rewardsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rewardsDistributed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalFeesCollected",
            "type": "u64"
          },
          {
            "name": "totalRewardsDistributed",
            "type": "u64"
          },
          {
            "name": "currentApy",
            "type": "u64"
          },
          {
            "name": "distributedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "solStaked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "lockPeriod",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "solUnstaked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lender",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "remainingStaked",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "subscriptionPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "developer",
            "type": "pubkey"
          },
          {
            "name": "months",
            "type": "u32"
          },
          {
            "name": "paymentAmount",
            "type": "u64"
          },
          {
            "name": "subscriptionValidUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "temporaryWalletFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "temporaryWallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fundedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "treasuryInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "treasuryWallet",
            "type": "pubkey"
          },
          {
            "name": "initialApy",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "treasuryPool",
      "docs": [
        "Fee-Based Treasury System with Reward-Per-Share Model",
        "",
        "Efficient reward distribution using accumulator pattern:",
        "- reward_per_share: Accumulator that increases when fees are credited",
        "- Each backer tracks reward_debt = deposited_amount * reward_per_share at deposit time",
        "- Claimable = (deposited_amount * reward_per_share - reward_debt) / PRECISION"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rewardPerShare",
            "type": "u128"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "liquidBalance",
            "type": "u64"
          },
          {
            "name": "rewardPoolBalance",
            "type": "u64"
          },
          {
            "name": "platformPoolBalance",
            "type": "u64"
          },
          {
            "name": "rewardFeeBps",
            "type": "u64"
          },
          {
            "name": "platformFeeBps",
            "type": "u64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "devWallet",
            "type": "pubkey"
          },
          {
            "name": "emergencyPause",
            "type": "bool"
          },
          {
            "name": "rewardPoolBump",
            "type": "u8"
          },
          {
            "name": "platformPoolBump",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "backerTotalStaked",
            "type": "u128"
          },
          {
            "name": "backerStakePoolBump",
            "type": "u8"
          },
          {
            "name": "totalRewardsDistributed",
            "type": "u128"
          },
          {
            "name": "adminPoolBalance",
            "type": "u128"
          },
          {
            "name": "adminPoolBump",
            "type": "u8"
          },
          {
            "name": "currentApyBps",
            "type": "u64"
          },
          {
            "name": "lastApyUpdateTs",
            "type": "i64"
          },
          {
            "name": "lastDistributionTime",
            "type": "i64"
          },
          {
            "name": "totalStaked",
            "type": "u64"
          },
          {
            "name": "totalFeesCollected",
            "type": "u64"
          },
          {
            "name": "currentApy",
            "type": "u64"
          },
          {
            "name": "treasuryWallet",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "userDeployStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "activeSessions",
            "type": "u32"
          },
          {
            "name": "dailyDeploys",
            "type": "u32"
          },
          {
            "name": "totalDeploys",
            "type": "u64"
          },
          {
            "name": "lastReset",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "backer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "requestedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
