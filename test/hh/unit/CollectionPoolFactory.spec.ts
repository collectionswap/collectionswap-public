import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { TokenIDs } from "filter_code";
import { ethers } from "hardhat";

import {
  DEFAULT_CREATE_ERC20_POOL_PARAMS,
  DEFAULT_CREATE_ETH_POOL_PARAMS,
  NUM_INITIAL_NFTS,
  PoolVariant,
} from "../shared/constants";
import { getGasToCost } from "../shared/ethGasReporter";
import {
  deployPoolContracts,
  nftFixture,
  test20Fixture,
} from "../shared/fixtures";
import {
  expectAddressToOwnNFTs,
  getPoolAddress,
  mintAndApproveRandomNfts,
  mintAndApproveRandomAmountToken,
  pickRandomElements,
  mintAndApproveNfts,
  toBigInt,
} from "../shared/helpers";
import {
  randomAddress,
  randomBigNumbers,
  randomEthValue,
} from "../shared/random";
import { getSigners } from "../shared/signers";

import type {
  TestCurve,
  Test20,
  Test721,
  Test721Enumerable,
  Test721Royalty,
} from "../../../typechain-types";
import type {
  CollectionPoolFactory,
  ICollectionPoolFactory,
} from "../../../typechain-types/contracts/pools/CollectionPoolFactory";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { BigNumber, ContractTransaction } from "ethers";

describe("CollectionPoolFactory", function () {
  let gasToCost: (gasUsed: BigNumber) => number;
  let collectionPoolFactory: CollectionPoolFactory;
  let testCurve: TestCurve;
  let test20: Test20;
  let test721: Test721;
  let test721Enumerable: Test721Enumerable;
  let test721Royalty: Test721Royalty;
  let collectionDeployer: SignerWithAddress;
  let user: SignerWithAddress;

  before("Get signers", async function () {
    ({ collectionDeployer, user } = await getSigners());
  });
  before(async function () {
    gasToCost = await getGasToCost();
  });

  beforeEach("Load factoryFixture ", async function () {
    ({
      factory: collectionPoolFactory,
      curves: { test: testCurve },
      test20,
      test721,
      test721Enumerable,
      test721Royalty,
    } = await loadFixture(collectionPoolFactoryFixture));
    collectionPoolFactory = collectionPoolFactory.connect(user);
  });

  describe("Create Pools", function () {
    testCreatePoolETH();
    testCreatePoolETH(true);
    testCreatePoolERC20();
    testCreatePoolERC20(true);

    function testCreatePoolETH(filtered = false) {
      describe(`#createPoolETH${filtered ? "Filtered" : ""}`, function () {
        beforeEach("Reset createETHPoolParams", function () {
          this.createETHPoolParams = {
            ...DEFAULT_CREATE_ETH_POOL_PARAMS,
            nft: test721.address,
            bondingCurve: testCurve.address,
            receiver: randomAddress(),
          };
        });

        it("Should transfer ETH to pool", async function () {
          const value = randomEthValue();
          const tx = await collectionPoolFactory.createPoolETH(
            this.createETHPoolParams,
            {
              value,
            }
          );
          const { newPoolAddress } = await getPoolAddress(tx);
          await expect(tx).changeEtherBalances(
            [user, newPoolAddress],
            [value.mul(-1), value]
          );
        });

        testCreatePool("ETH", filtered);

        testPoolVariant("ETH", filtered);

        if (filtered) {
          testFilter("ETH");
        }
      });
    }

    function testCreatePoolERC20(filtered = false) {
      describe(`#createPoolERC20${filtered ? "Filtered" : ""}`, function () {
        beforeEach("Reset createERC20PoolParams", function () {
          this.createERC20PoolParams = {
            ...DEFAULT_CREATE_ERC20_POOL_PARAMS,
            token: test20.address,
            nft: test721.address,
            bondingCurve: testCurve.address,
            receiver: randomAddress(),
          };
        });

        it("Should transfer ERC20 to pool", async function () {
          const amount = await mintAndApproveRandomAmountToken(
            test20,
            user,
            collectionPoolFactory.address
          );

          const tx = await collectionPoolFactory.createPoolERC20({
            ...this.createERC20PoolParams,
            initialTokenBalance: amount,
          });
          const { newPoolAddress } = await getPoolAddress(tx);
          await expect(tx).changeTokenBalances(
            test20,
            [user, newPoolAddress],
            [amount.mul(-1), amount]
          );
        });

        testCreatePool("ERC20", filtered);

        testPoolVariant("ERC20", filtered);

        if (filtered) {
          testFilter("ERC20");
        }
      });
    }

    function testCreatePool(key: "ETH" | "ERC20", filtered = false) {
      describe("Bonding Curve", function () {
        context("With whitelisted bonding curve", function () {
          it("Should not revert", async function () {
            await expect(
              createPool.bind(this)(key, filtered)
            ).not.to.be.reverted;
          });
        });

        context("With non-whitelisted bonding curve", function () {
          it("Should revert", async function () {
            this[`create${key}PoolParams`].bondingCurve =
              ethers.constants.AddressZero;

            await expect(
              createPool.bind(this)(key, filtered)
            ).to.be.revertedWith("Bonding curve not whitelisted");
          });
        });
      });

      describe("LP Token", function () {
        context("With zero address receiver", function () {
          it("Should revert", async function () {
            this[`create${key}PoolParams`].receiver =
              ethers.constants.AddressZero;

            await expect(
              createPool.bind(this)(key, filtered)
            ).to.be.revertedWith("ERC721: mint to the zero address");
          });
        });

        context("With non-zero address receiver", function () {
          it("Should not revert", async function () {
            await expect(
              createPool.bind(this)(key, filtered)
            ).not.to.be.reverted;
          });
        });

        it("Should emit lp token to receiver", async function () {
          const tx = await createPool.bind(this)(key, filtered);
          const { newTokenId } = await getPoolAddress(tx);
          expect(await collectionPoolFactory.ownerOf(newTokenId)).to.equal(
            this[`create${key}PoolParams`].receiver
          );
        });

        it("Should increment lp token id", async function () {
          const tx = await createPool.bind(this)(key, filtered);
          const { newTokenId } = await getPoolAddress(tx);
          expect(
            (await callStaticCreatePool.bind(this)(key, filtered)).tokenId
          ).to.equal(newTokenId.add(ethers.constants.One));
        });
      });

      describe("Royalties", function () {
        context("With valid royalty state", function () {
          beforeEach("Make royalty state valid", function () {
            if (Math.random() < 0.5) {
              this[`create${key}PoolParams`].nft = test721Royalty.address;
            } else {
              this[`create${key}PoolParams`].royaltyRecipientFallback =
                randomAddress();
            }
          });

          context("With non-zero royalty numerator = 1e18", function () {
            it("should revert", async function () {
              this[`create${key}PoolParams`].royaltyNumerator =
                ethers.utils.parseEther("1");

              await expect(
                createPool.bind(this)(key, filtered)
              ).to.be.revertedWith("royaltyNumerator must be < 1e18");
            });
          });

          context("With non-zero royalty numerator >= 1e18", function () {
            it("should revert", async function () {
              this[`create${key}PoolParams`].royaltyNumerator =
                ethers.constants.MaxUint256.sub(randomEthValue(1));

              await expect(
                createPool.bind(this)(key, filtered)
              ).to.be.revertedWith("royaltyNumerator must be < 1e18");
            });
          });
        });

        describe("Royalty state", function () {
          withRoyaltyNumerator(function () {
            withERC2981(withroyaltyRecipientFallback(shouldRevert))();
            withroyaltyRecipientFallback(withERC2981(shouldRevert))();
          })();
          withERC2981(function () {
            withRoyaltyNumerator(withroyaltyRecipientFallback(shouldRevert))();
            withroyaltyRecipientFallback(withRoyaltyNumerator(shouldRevert))();
          })();
          withroyaltyRecipientFallback(function () {
            withERC2981(withRoyaltyNumerator(shouldRevert))();
            withRoyaltyNumerator(withERC2981(shouldRevert))();
          })();

          function withRoyaltyNumerator(fn: () => void) {
            return function () {
              context("With zero royalty numerator", function () {
                it("Should not revert", async function () {
                  await expect(
                    createPool.bind(this)(key, filtered)
                  ).not.to.be.reverted;
                });
              });

              context("With non-zero royalty numerator < 1e18", function () {
                beforeEach("Set random royalty numerator < 1e18", function () {
                  const royaltyNumerator = randomEthValue(1);
                  expect(royaltyNumerator).to.lessThan(
                    ethers.utils.parseEther("1")
                  );
                  this[`create${key}PoolParams`].royaltyNumerator =
                    royaltyNumerator;
                });

                fn();
              });
            };
          }

          function withERC2981(fn: () => void) {
            return function () {
              context("With ERC2981", function () {
                it("Should not revert", async function () {
                  this[`create${key}PoolParams`].nft = test721Royalty.address;

                  await expect(
                    createPool.bind(this)(key, filtered)
                  ).not.to.be.reverted;
                });
              });

              context("With non-ERC2981", function () {
                fn();
              });
            };
          }

          function withroyaltyRecipientFallback(fn: () => void) {
            return function () {
              context("With royalty recipient fallback", function () {
                it("Should not revert", async function () {
                  this[`create${key}PoolParams`].royaltyRecipientFallback =
                    randomAddress();

                  await expect(
                    createPool.bind(this)(key, filtered)
                  ).not.to.be.reverted;
                });
              });

              context("Without royalty recipient fallback", function () {
                fn();
              });
            };
          }

          function shouldRevert() {
            it("Should revert", async function () {
              await expect(
                createPool.bind(this)(key, filtered)
              ).to.be.revertedWith(
                "Nonzero royalty for non ERC2981 without fallback"
              );
            });
          }
        });
      });

      describe.skip("Gas", function () {
        context("With enumerable", function () {
          beforeEach("Set enumerable nft", function () {
            this.nft = test721Enumerable;
          });

          testGas();
        });

        context("With non-enumerable", function () {
          beforeEach("Set non-enumerable nft", function () {
            this.nft = test721;
          });

          testGas();
        });

        function testGas() {
          for (let i = 0; i <= NUM_INITIAL_NFTS; i++) {
            context(`With ${i} nfts`, function () {
              it("Should be gas efficient", async function () {
                const tokenIds = await mintAndApproveRandomNfts(
                  this.nft,
                  user,
                  collectionPoolFactory.address,
                  i
                );

                let filterParams;
                if (tokenIds.length) {
                  const biTokenIds = tokenIds.map(toBigInt);
                  const tokenIDs = new TokenIDs(biTokenIds);
                  const { proof: initialProof, proofFlags: initialProofFlags } =
                    tokenIDs.proof(biTokenIds);
                  filterParams = {
                    merkleRoot: tokenIDs.root(),
                    encodedTokenIDs: tokenIDs.encode(),
                    initialProof,
                    initialProofFlags,
                  };
                }

                const tx = await createPool.bind(this)(
                  key,
                  filtered,
                  {
                    nft: this.nft.address,
                    initialNFTIDs: tokenIds,
                  },
                  filterParams
                );
                const receipt = await tx.wait();
                const { gasUsed } = receipt;
                console.log(
                  `Used ${gasUsed.toString()} gas, cost $${gasToCost(gasUsed)}`
                );
              });
            });
          }
        }
      });

      it("Should emit NewPool event", async function () {
        const { pool, tokenId } = await callStaticCreatePool.bind(this)(
          key,
          filtered
        );
        await expect(createPool.bind(this)(key, filtered))
          .to.emit(collectionPoolFactory, "NewPool")
          .withArgs(pool, tokenId);
      });

      it("Should transfer NFTs to pool", async function () {
        const tokenIds = await mintAndApproveRandomNfts(
          test721,
          user,
          collectionPoolFactory.address,
          NUM_INITIAL_NFTS
        );

        const tx = await createPool.bind(this)(key, filtered, {
          initialNFTIDs: tokenIds,
        });
        const { newPoolAddress } = await getPoolAddress(tx);
        await expectAddressToOwnNFTs(newPoolAddress, test721, tokenIds);
      });
    }

    function testFilter(key: "ETH" | "ERC20") {
      beforeEach("Reset filterParams", function () {
        this.filterParams = {
          merkleRoot: ethers.constants.HashZero,
          encodedTokenIDs: ethers.constants.HashZero,
          initialProof: [],
          initialProofFlags: [],
        };
      });

      context("With filter", function () {
        beforeEach("Set filter", function () {
          this.tokenIds = randomBigNumbers(NUM_INITIAL_NFTS);
          this.tokenIDs = new TokenIDs(this.tokenIds.map(toBigInt));
          this.filterParams.merkleRoot = this.tokenIDs.root();
          this.filterParams.encodedTokenIDs = this.tokenIDs.encode();
        });

        context("With initial nft ids as proof", function () {
          context("With empty", function () {
            it("Should not revert", async function () {
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof([]);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  this[`create${key}PoolParams`],
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With a non-empty subset", function () {
            it("Should not revert", async function () {
              const tokenIds = pickRandomElements<BigNumber>(
                this.tokenIds,
                this.tokenIds.length / 2
              );
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof(biTokenIds);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  {
                    ...this[`create${key}PoolParams`],
                    initialNFTIDs: this.tokenIDs.sort(biTokenIds),
                  },
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With the full set", function () {
            it("Should not revert", async function () {
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                this.tokenIds
              );

              const biTokenIds = this.tokenIds.map(toBigInt);
              const { proof: initialProof, proofFlags: initialProofFlags } =
                this.tokenIDs.proof(biTokenIds);

              await expect(
                collectionPoolFactory[`createPool${key}Filtered`](
                  {
                    ...this[`create${key}PoolParams`],
                    initialNFTIDs: this.tokenIDs.sort(biTokenIds),
                  },
                  {
                    ...this.filterParams,
                    initialProof,
                    initialProofFlags,
                  }
                )
              ).not.to.be.reverted;
            });
          });

          context("With a superset", function () {
            it("Should not be able to get proof", async function () {
              const tokenIds = [
                ...randomBigNumbers(NUM_INITIAL_NFTS),
                ...this.tokenIds,
              ] as BigNumber[];
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });

          context("With union of non-empty subsets", function () {
            it("Should not be able to get proof", async function () {
              const randomTokenIds = randomBigNumbers(NUM_INITIAL_NFTS);
              const tokenIds = [
                ...pickRandomElements(
                  randomTokenIds,
                  randomTokenIds.length / 2
                ),
                ...pickRandomElements(this.tokenIds, this.tokenIds.length / 2),
              ] as BigNumber[];
              await mintAndApproveNfts(
                test721,
                user,
                collectionPoolFactory.address,
                tokenIds
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });

          context("With non-empty subset of complement", function () {
            it("Should not be able to get proof", async function () {
              const tokenIds = await mintAndApproveRandomNfts(
                test721,
                user,
                collectionPoolFactory.address,
                NUM_INITIAL_NFTS
              );

              const biTokenIds = tokenIds.map(toBigInt);
              expect(() => this.tokenIDs.proof(biTokenIds)).to.throw(
                "Leaf is not in tree"
              );
            });
          });
        });
      });
    }

    /**
     * Tests if the pools created are of the correct variant.
     */
    function testPoolVariant(key: "ETH" | "ERC20", filtered = false) {
      context("With enumerable", function () {
        beforeEach("Set enumerable nft", function () {
          this[`create${key}PoolParams`].nft = test721Enumerable.address;
        });

        it(`Should be enumerable ${key} variant`, async function () {
          const tx = await createPool.bind(this)(key, filtered);
          const { newPoolAddress } = await getPoolAddress(tx);
          const collectionPool = await ethers.getContractAt(
            "CollectionPool",
            newPoolAddress
          );

          expect(await collectionPool.poolVariant()).to.equal(
            PoolVariant[`ENUMERABLE_${key}`]
          );
        });
      });

      context("With non-enumerable", function () {
        it("Should be missing enumerable eth variant", async function () {
          const tx = await createPool.bind(this)(key, filtered);
          const { newPoolAddress } = await getPoolAddress(tx);
          const collectionPool = await ethers.getContractAt(
            "CollectionPool",
            newPoolAddress
          );

          expect(await collectionPool.poolVariant()).to.equal(
            PoolVariant[`MISSING_ENUMERABLE_${key}`]
          );
        });
      });
    }

    async function createPool(
      key: "ETH" | "ERC20",
      filtered = false,
      poolParamsOverride?:
        | Partial<ICollectionPoolFactory.CreateETHPoolParamsStruct>
        | Partial<ICollectionPoolFactory.CreateERC20PoolParamsStruct>,
      filterParamsOverride?: Partial<ICollectionPoolFactory.NFTFilterParamsStruct>
    ): Promise<ContractTransaction> {
      const poolParams = {
        ...this[`create${key}PoolParams`],
        ...poolParamsOverride,
      };
      if (filtered) {
        return collectionPoolFactory[`createPool${key}Filtered`](poolParams, {
          ...this.filterParams,
          filterParamsOverride,
        });
      }

      return collectionPoolFactory[`createPool${key}`](poolParams);
    }

    async function callStaticCreatePool(
      key: "ETH" | "ERC20",
      filtered = false
    ): Promise<{
      pool: string;
      tokenId: BigNumber;
    }> {
      if (filtered) {
        return collectionPoolFactory.callStatic[`createPool${key}Filtered`](
          this[`create${key}PoolParams`],
          this.filterParams
        );
      }

      return collectionPoolFactory.callStatic[`createPool${key}`](
        this[`create${key}PoolParams`]
      );
    }
  });

  describe("URI", function () {
    const baseURI = "https://collection.xyz/api/";

    describe("#setBaseURI", function () {
      context("With non-owner", function () {
        it("Should revert", async function () {
          await expect(
            collectionPoolFactory.setBaseURI(baseURI)
          ).to.be.reverted;
        });
      });
      context("With owner", function () {
        it("Should set base URI", async function () {
          await collectionPoolFactory
            .connect(collectionDeployer)
            .setBaseURI(baseURI);

          expect(await collectionPoolFactory.baseURI()).to.equal(baseURI);
        });
      });
    });

    describe("#tokenURI", function () {
      it("Should be a concatenation of baseURI and tokenId", async function () {
        // set base uri
        await collectionPoolFactory
          .connect(collectionDeployer)
          .setBaseURI(baseURI);

        // emit lp token
        const tx = await collectionPoolFactory.createPoolETH({
          ...DEFAULT_CREATE_ETH_POOL_PARAMS,
          nft: test721.address,
          bondingCurve: testCurve.address,
          receiver: randomAddress(),
        });
        const { newTokenId: tokenId } = await getPoolAddress(tx);

        expect(await collectionPoolFactory.tokenURI(tokenId)).to.equal(
          baseURI + tokenId
        );
      });
    });
  });
});

async function collectionPoolFactoryFixture() {
  return {
    ...(await deployPoolContracts()),
    ...(await nftFixture()),
    test20: await test20Fixture(),
  };
}
