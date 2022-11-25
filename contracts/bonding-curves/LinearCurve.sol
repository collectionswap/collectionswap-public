// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {ICurve} from "./ICurve.sol";
import {CurveErrorCodes} from "./CurveErrorCodes.sol";
// import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

// original sudoswap code points to an old version of solmate in raricapital library (deprecated), 
// later versions omit fpow and fmul, we use the new version with the functions added back in
import {FixedPointMathLib} from "../lib/FixedPointMathLib.sol";

/*
    @author 0xmons and boredGenius
    @notice Bonding curve logic for a linear curve, where each buy/sell changes spot price by adding/substracting delta
*/
contract LinearCurve is ICurve, CurveErrorCodes {
    using FixedPointMathLib for uint256;

    /**
        @dev See {ICurve-validateDelta}
     */
    function validateDelta(
        uint128 /*delta*/
    ) external pure override returns (bool valid) {
        // For a linear curve, all values of delta are valid
        return true;
    }

    /**
        @dev See {ICurve-validateSpotPrice}
     */
    function validateSpotPrice(
        uint128 /* newSpotPrice */
    ) external pure override returns (bool) {
        // For a linear curve, all values of spot price are valid
        return true;
    }

    /**
        @dev See {ICurve-validateProps}
     */
    function validateProps(
        bytes calldata /*props*/
    ) external pure override returns (bool valid) {
        // For a linear curve, all values of props are valid
        return true;
    }

    /**
        @dev See {ICurve-validateState}
     */
    function validateState(
        bytes calldata /*state*/
    ) external pure override returns (bool valid) {
        // For a linear curve, all values of state are valid
        return true;
    }

    /**
        @dev See {ICurve-getBuyInfo}
     */
    function getBuyInfo(
        ICurve.Params calldata params,
        uint256 numItems,
        ICurve.FeeMultipliers calldata feeMultipliers
    )
        external
        pure
        override
        returns (
            Error error,
            uint128 newSpotPrice,
            uint128 newDelta,
            bytes memory newState,
            uint256 inputValue,
            uint256 tradeFee,
            uint256 protocolFee,
            uint256[] memory royaltyAmounts
        )
    {
        // We only calculate changes for buying 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0, new uint256[](0));
        }

        // For a linear curve, the spot price increases by delta for each item bought
        uint256 newSpotPrice_ = params.spotPrice + params.delta * numItems;
        if (newSpotPrice_ > type(uint128).max) {
            return (Error.SPOT_PRICE_OVERFLOW, 0, 0, "", 0, 0, 0, new uint256[](0));
        }
        newSpotPrice = uint128(newSpotPrice_);

        // Spot price is assumed to be the instant sell price. To avoid arbitraging LPs, we adjust the buy price upwards.
        // If spot price for buy and sell were the same, then someone could buy 1 NFT and then sell for immediate profit.
        // EX: Let S be spot price. Then buying 1 NFT costs S ETH, now new spot price is (S+delta).
        // The same person could then sell for (S+delta) ETH, netting them delta ETH profit.
        // If spot price for buy and sell differ by delta, then buying costs (S+delta) ETH.
        // The new spot price would become (S+delta), so selling would also yield (S+delta) ETH.
        uint256 buySpotPrice = params.spotPrice + params.delta;

        // If we buy n items, then the total cost is equal to:
        // (buy spot price) + (buy spot price + 1*delta) + (buy spot price + 2*delta) + ... + (buy spot price + (n-1)*delta)
        // This is equal to n*(buy spot price) + (delta)*(n*(n-1))/2
        // because we have n instances of buy spot price, and then we sum up from delta to (n-1)*delta
        inputValue =
            numItems *
            buySpotPrice +
            (numItems * (numItems - 1) * params.delta) /
            2;

        // Account for the protocol fee, a flat percentage of the buy amount, only for Non-Trade pools
        protocolFee = inputValue.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );

        // Account for the trade fee, only for Trade pools
        tradeFee = inputValue.fmul(feeMultipliers.trade, FixedPointMathLib.WAD);

        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;
        
        royaltyAmounts = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i = 0; i < numItems; ) {
            uint256 royaltyAmount = (buySpotPrice + (params.delta * i)).fmul(
                feeMultipliers.royaltyNumerator,
                FixedPointMathLib.WAD
            );
            royaltyAmounts[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        // Account for the trade fee (only for Trade pools) and protocol fee
        inputValue += tradeFee + protocolFee + totalRoyalty;

        // Keep delta the same
        newDelta = params.delta;

        // Keep state the same
        newState = params.state;

        // If we got all the way here, no math error happened
        error = Error.OK;
    }

    /**
        @dev See {ICurve-getSellInfo}
     */
    function getSellInfo(
        ICurve.Params calldata params,
        uint256 numItems,
        ICurve.FeeMultipliers calldata feeMultipliers
    )
        external
        pure
        override
        returns (
            Error error,
            uint128 newSpotPrice,
            uint128 newDelta,
            bytes memory newState,
            uint256 outputValue,
            uint256 tradeFee,
            uint256 protocolFee,
            uint256[] memory royaltyAmounts
        )
    {
        // We only calculate changes for selling 1 or more NFTs
        if (numItems == 0) {
            return (Error.INVALID_NUMITEMS, 0, 0, "", 0, 0, 0, new uint256[](0));
        }

        // We first calculate the change in spot price after selling all of the items
        uint256 totalPriceDecrease = params.delta * numItems;

        // If the current spot price is less than the total amount that the spot price should change by...
        if (params.spotPrice < totalPriceDecrease) {
            // Then we set the new spot price to be 0. (Spot price is never negative)
            newSpotPrice = 0;

            // We calculate how many items we can sell into the linear curve until the spot price reaches 0, rounding up
            uint256 numItemsTillZeroPrice = params.spotPrice / params.delta + 1;
            numItems = numItemsTillZeroPrice;
        }
        // Otherwise, the current spot price is greater than or equal to the total amount that the spot price changes
        // Thus we don't need to calculate the maximum number of items until we reach zero spot price, so we don't modify numItems
        else {
            // The new spot price is just the change between spot price and the total price change
            newSpotPrice = params.spotPrice - uint128(totalPriceDecrease);
        }

        // If we sell n items, then the total sale amount is:
        // (spot price) + (spot price - 1*delta) + (spot price - 2*delta) + ... + (spot price - (n-1)*delta)
        // This is equal to n*(spot price) - (delta)*(n*(n-1))/2
        outputValue =
            numItems *
            params.spotPrice -
            (numItems * (numItems - 1) * params.delta) /
            2;

        // Account for the protocol fee, a flat percentage of the sell amount, only for Non-Trade pools
        protocolFee = outputValue.fmul(
            feeMultipliers.protocol,
            FixedPointMathLib.WAD
        );

        // Account for the trade fee, only for Trade pools
        tradeFee = outputValue.fmul(feeMultipliers.trade, FixedPointMathLib.WAD);

        // Account for the carry fee, only for Trade pools
        uint256 carryFee = tradeFee.fmul(feeMultipliers.carry, FixedPointMathLib.WAD);
        tradeFee -= carryFee;
        protocolFee += carryFee;

        royaltyAmounts = new uint256[](numItems);
        uint256 totalRoyalty;
        for (uint256 i = 0; i < numItems; ) {
            uint256 royaltyAmount = (params.spotPrice - (params.delta * i)).fmul(
                feeMultipliers.royaltyNumerator,
                FixedPointMathLib.WAD
            );
            royaltyAmounts[i] = royaltyAmount;
            totalRoyalty += royaltyAmount;

            unchecked {
                ++i;
            }
        }

        // Account for the trade fee (only for Trade pools), protocol fee, and
        // royalties
        outputValue -= tradeFee + protocolFee + totalRoyalty;

        // Keep delta the same
        newDelta = params.delta;

        // Keep state the same
        newState = params.state;

        // If we reached here, no math errors
        error = Error.OK;
    }
}
