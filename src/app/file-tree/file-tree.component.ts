import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { NestedTreeControl } from '@angular/cdk/tree';
import { FileTree } from "../models/models";
import { MatTreeNestedDataSource } from '@angular/material/tree';

@Component({
  selector: 'app-file-tree',
  templateUrl: './file-tree.component.html',
  styleUrls: ['./file-tree.component.css']
})
export class FileTreeComponent implements OnInit, OnChanges {

  @Input() fileTree: FileTree[] = [];
  @Output() nodeSelected = new EventEmitter<string>();  // Emit when a node is selected (clicked)
  @Output() nodeDoubleClicked = new EventEmitter<string>();  // Emit when a node is double-clicked

  selectedNode: any = null;

  // Use NestedTreeControl for hierarchical data
  treeControl = new NestedTreeControl<FileTree>(node => node.children);

  // Use MatTreeNestedDataSource for hierarchical data
  dataSource = new MatTreeNestedDataSource<FileTree>();

  ngOnInit() {
    if (this.fileTree) {
      this.updateTreeData();
    } else {
      console.error("File tree data not available");
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['fileTree']) {
      this.updateTreeData();
    }
  }

  updateTreeData() {
    if (this.fileTree && Array.isArray(this.fileTree)) {
      const sortedTree = this.sortTree(this.fileTree);
      this.dataSource.data = sortedTree;
      this.treeControl.dataNodes = sortedTree;
    } else {
      console.error("fileTree is not initialized or empty");
    }
  }

  onNodeSelect(node: FileTree) {
    if (!node) {
      console.error("Node is undefined or invalid");
      return;
    }

    // Only allow selection of file nodes
    if (!node.isDirectory) {
      this.selectedNode = node;  // Update selected node only if it's a file
      this.nodeSelected.emit(node.path);  // Emit the selected file path (single click)
    } else {
      console.log("Cannot select directories.");
    }
  }

  // Handle double-click events
  onNodeDoubleClick(node: FileTree) {
    if (!node.isDirectory) {
      this.nodeDoubleClicked.emit(node.path);  // Emit double-clicked file path
    }
  }

  // Sorting function to sort directories before files, and alphabetically within each group
  sortTree(tree: FileTree[]): FileTree[] {
    return tree.map(node => {
      // Recursively sort children if they exist
      if (node.children && node.children.length > 0) {
        node.children = this.sortTree(node.children);
      }
      return node;
    }).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) {
        return -1;
      } else if (!a.isDirectory && b.isDirectory) {
        return 1;
      } else {
        return a.name.localeCompare(b.name);
      }
    });
  }

  // Predicate function to check if a node is a directory
  isDirectory(_: number, node: FileTree | null): boolean {
    return node?.isDirectory ?? false;
  }

  // Predicate function to check if a node is a file
  isFile(_: number, node: FileTree | null): boolean {
    return !node?.isDirectory ?? false;
  }
}
