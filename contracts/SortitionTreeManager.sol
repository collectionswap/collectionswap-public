// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SortitionSumTreeFactory} from "./lib/SortitionSumTreeFactory.sol";
import {ISortitionTreeManager} from "./ISortitionTreeManager.sol";

contract SortitionTreeManager is ISortitionTreeManager {
    using SortitionSumTreeFactory for SortitionSumTreeFactory.SortitionSumTrees;

    mapping(address => SortitionSumTreeFactory.SortitionSumTrees) private userTrees;

    function createTree(bytes32 _key, uint _K) public {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        trees.createTree(_key, _K);
    }

    function set(bytes32 _key, uint _value, bytes32 _ID) public {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        trees.set(_key, _value, _ID);
    } 

    function queryLeafs(
        bytes32 _key,
        uint _cursor,
        uint _count
    ) public view returns(uint startIndex, uint[] memory values, bool hasMore) {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        return trees.queryLeafs(_key, _cursor, _count);
    }

    function draw(bytes32 _key, uint _drawnNumber) public view returns(bytes32 ID) {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        return trees.draw(_key, _drawnNumber);
    }

    function stakeOf(bytes32 _key, bytes32 _ID) public view returns(uint value) {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        return trees.stakeOf(_key, _ID);
    }

    function total(bytes32 _key) public view returns (uint) {
        SortitionSumTreeFactory.SortitionSumTrees storage trees = userTrees[msg.sender];
        return trees.total(_key);
    }
}