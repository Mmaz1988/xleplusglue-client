import { LigerQuerySolution } from '../models/models';

/** Highlighting a LiGER query's matches on a rendered graph, shared by the graph inspector and
 *  the home page's query demo so both mark a solution the same way. */

/** Every node a solution binds, across all its variables. */
export function solutionNodeIds(solution: LigerQuerySolution): Set<string> {
  const ids = new Set<string>();

  Object.values(solution.bindings).forEach(nodes => {
    Object.keys(nodes).forEach(nodeId => ids.add(String(nodeId)));
  });

  return ids;
}

export function cloneGraphElement(element: any): any {
  return {
    ...element,
    data: element?.data ? {...element.data} : element?.data,
  };
}

/** A copy of the elements with exactly the given ids marked as query matches. */
export function applyQueryHighlights(elements: any[], highlightedIds: Set<string>): any[] {
  return elements.map(element => {
    const nodeId = element?.data?.id;
    if (!nodeId) {
      return element;
    }

    const nextElement = cloneGraphElement(element);
    if (highlightedIds.has(String(nextElement.data.id))) {
      nextElement.data.query_selector = 'query-match';
    } else {
      delete nextElement.data.query_selector;
    }
    return nextElement;
  });
}
