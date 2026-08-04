/**
 * =============================================================================
 * FILE: src/lib/timelineLayout.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Computes pixel positions for a day's scheduled tasks so the Timeline can
 *   render each one PROPORTIONAL to its actual duration (a 90-minute task
 *   visibly taller than a 30-minute one), instead of every task showing as
 *   an identical fixed-height block regardless of how long it actually is.
 *
 * KEY RESPONSIBILITIES
 *   - Convert each task's start_time + duration_minutes into a top/height
 *     pixel offset within the timeline's absolute-positioned container.
 *   - Handle tasks that OVERLAP in time (e.g. two events both starting
 *     around 2pm) by placing them side-by-side in "lanes" instead of
 *     stacking them on top of each other unreadably — this is the same
 *     general approach real calendar apps (Google Calendar, etc.) use.
 *
 * ALGORITHM (layoutTasks)
 *   1. Convert each task to a {start, end} minute interval and sort by start.
 *   2. Sweep through in order, grouping tasks into "clusters" of mutually
 *      overlapping intervals (a new cluster starts whenever a task begins
 *      at or after every previously-seen task in the current cluster has
 *      already ended).
 *   3. Within each cluster, greedily assign each task to the first "lane"
 *      whose previous occupant has already ended by this task's start time
 *      (reusing lanes when possible); if none free, open a new lane.
 *   4. Each task's rendered width = 1 / (lanes used in ITS cluster), so
 *      clusters of 1 render full-width, clusters of 2 render half-width
 *      side-by-side, etc. — clusters don't affect each other's width.
 *
 * EDGE CASES
 *   - Tasks with missing/invalid start_time are filtered out before layout
 *     runs (callers should only pass already-scheduled tasks).
 *   - Zero or negative duration is not expected (TaskModal enforces a
 *     5-minute minimum) but this module clamps to 1 minute defensively so a
 *     malformed row can't produce a zero-height/invisible block.
 * =============================================================================
 */

import { timeToMinutes } from './recurrence'

/**
 * @param {Array<object>} tasks - scheduled tasks (must have start_time, duration_minutes)
 * @returns {Array<{task: object, startMin: number, endMin: number, lane: number, lanesInCluster: number}>}
 */
export function layoutTasks(tasks) {
  const items = tasks
    .filter((t) => t.start_time)
    .map((t) => {
      const startMin = timeToMinutes(t.start_time)
      const durationMin = Math.max(1, t.duration_minutes || 30)
      return { task: t, startMin, endMin: startMin + durationMin }
    })
    .sort((a, b) => a.startMin - b.startMin)

  const positioned = []
  let cluster = []
  let clusterEnd = -Infinity

  // flushCluster: assign lanes within the accumulated `cluster`, then push
  // the results (with each item's final lane + total lane count) into
  // `positioned`, and reset for the next cluster.
  function flushCluster() {
    if (!cluster.length) return
    const laneEnds = [] // laneEnds[i] = end-minute of the task currently occupying lane i
    for (const item of cluster) {
      let lane = laneEnds.findIndex((endMin) => endMin <= item.startMin)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(item.endMin)
      } else {
        laneEnds[lane] = item.endMin
      }
      item.lane = lane
    }
    const lanesInCluster = laneEnds.length
    for (const item of cluster) {
      positioned.push({ ...item, lanesInCluster })
    }
    cluster = []
    clusterEnd = -Infinity
  }

  for (const item of items) {
    // A new cluster begins once this task starts at/after every task
    // currently in the cluster has finished (no time overlap with anything
    // accumulated so far).
    if (cluster.length && item.startMin >= clusterEnd) {
      flushCluster()
    }
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  flushCluster()

  return positioned
}
