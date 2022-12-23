// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {TransferLib} from "../lib/TransferLib.sol";
import {ICollectionPool} from "../pools/ICollectionPool.sol";
import {CollectionPool} from "../pools/CollectionPool.sol";
import {CollectionRouter} from "../routers/CollectionRouter.sol";

/**
 * @title An NFT/Token pool for an NFT that does not implement ERC721Enumerable
 * @author Collection
 */
abstract contract CollectionPoolMissingEnumerable is CollectionPool {
    using EnumerableSet for EnumerableSet.UintSet;

    // Used for internal ID tracking
    EnumerableSet.UintSet private idSet;

    /// @inheritdoc CollectionPool
    function _selectArbitraryNFTs(IERC721, uint256 numNFTs) internal override returns (uint256[] memory tokenIds) {
        tokenIds = new uint256[](numNFTs);
        // We're missing enumerable, so we also update the pool's own ID set
        // NOTE: We start from last index to first index to save on gas
        uint256 lastIndex = idSet.length() - 1;
        for (uint256 i; i < numNFTs;) {
            uint256 nftId = idSet.at(lastIndex);
            tokenIds[i] = nftId;
            idSet.remove(nftId);

            unchecked {
                --lastIndex;
                ++i;
            }
        }
    }

    /// @inheritdoc CollectionPool
    function _sendSpecificNFTsToRecipient(IERC721 _nft, address nftRecipient, uint256[] memory nftIds)
        internal
        override
    {
        // Send NFTs to caller
        // If missing enumerable, update pool's own ID set
        uint256 numNFTs = nftIds.length;
        for (uint256 i; i < numNFTs;) {
            _nft.safeTransferFrom(address(this), nftRecipient, nftIds[i]);
            // Remove from id set
            idSet.remove(nftIds[i]);

            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc CollectionPool
    function getAllHeldIds() external view override returns (uint256[] memory) {
        uint256 numNFTs = idSet.length();
        uint256[] memory ids = new uint256[](numNFTs);
        for (uint256 i; i < numNFTs;) {
            ids[i] = idSet.at(i);

            unchecked {
                ++i;
            }
        }
        return ids;
    }

    /**
     * @dev When safeTransfering an ERC721 in, we add ID to the idSet
     * if it's the same collection used by pool. (As it doesn't auto-track because no ERC721Enumerable)
     */
    function onERC721Received(address, address, uint256 id, bytes memory) public virtual returns (bytes4) {
        IERC721 _nft = nft();
        // If it's from the pool's NFT, add the ID to ID set
        if (msg.sender == address(_nft)) {
            idSet.add(id);
        }
        return this.onERC721Received.selector;
    }

    /// @inheritdoc ICollectionPool
    function withdrawERC721(IERC721 a, uint256[] calldata nftIds) external override onlyAuthorized {
        IERC721 _nft = nft();
        address owner = owner();

        // If it's not the pool's NFT, just withdraw normally
        if (a != _nft) {
            TransferLib.bulkSafeTransferERC721From(a, address(this), owner, nftIds);
        }
        // Otherwise, withdraw and also remove the ID from the ID set
        else {
            _sendSpecificNFTsToRecipient(_nft, owner, nftIds);

            emit NFTWithdrawal();
        }
    }
}
